"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { splitName } from "@/lib/registration/schema";
import { getLocalDate } from "@/lib/date";
import { VBS_DATES } from "@/lib/registration/dates";
import { resolveDayRecordUpdate } from "@/lib/day-record-plan";
import { assignLegsForVan } from "@/lib/van-assign";
import { boardedStopConflict } from "@/lib/routing";

// -- Update student profile (name, allergies, medical notes) --

const UpdateStudentSchema = z.object({
  studentId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").optional(),
  allergies: z.string().trim().optional(),
  medicalNotes: z.string().trim().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").nullable().optional(),
  ageAtRegistration: z.number().int("Age must be a whole number").min(0).max(120).nullable().optional(),
}).superRefine((data, ctx) => {
  // The DB requires a child to have a DOB or an age. If the form sends both and
  // both are empty, reject with a friendly message instead of a raw DB error.
  if (data.dob !== undefined && data.ageAtRegistration !== undefined) {
    if (data.dob == null && data.ageAtRegistration == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a date of birth or an age.",
        path: ["dob"],
      });
    }
  }
});

export type UpdateStudentResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: update a student's profile fields. Only changed fields
 * need to be sent. Used for day-of corrections: "this kid actually has a
 * peanut allergy" or "call him Jake, not Jacob."
 */
export async function updateStudent(
  input: unknown,
): Promise<UpdateStudentResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { studentId, ...fields } = parsed.data;

  // Build the update payload from only the fields that were provided
  const updates: Record<string, string | number | null> = {};
  if (fields.name !== undefined) {
    const { first, last } = splitName(fields.name);
    updates.legal_first_name = first;
    updates.legal_last_name = last;
    // The single-name model is authoritative; clear any old preferred-name
    // override so the edited name is what shows everywhere.
    updates.preferred_first_name = null;
  }
  if (fields.allergies !== undefined) {
    updates.allergies = fields.allergies || null;
  }
  if (fields.medicalNotes !== undefined) {
    updates.medical_notes = fields.medicalNotes || null;
  }
  if (fields.dob !== undefined) {
    updates.dob = fields.dob;
  }
  if (fields.ageAtRegistration !== undefined) {
    updates.age_at_registration = fields.ageAtRegistration;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update(updates as never)
    .eq("id", studentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  return { ok: true };
}

// -- Archive / restore a student --

const ArchiveStudentSchema = z.object({ studentId: z.string().uuid() });

export type ArchiveStudentResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: archive a student. The child is hidden from every roster
 * and operational screen (the student_day_status view excludes archived
 * students), but all of their records — events, consents, day-records — are
 * RETAINED. Use for a test/junk registration or a child who isn't coming.
 *
 * This replaces the old hard delete, which tried to delete student_day_events
 * (rejected by the append-only trigger) and would have erased custody history.
 * Archive is a single UPDATE; a coordinator can restore via unarchiveStudent.
 */
export async function archiveStudent(input: unknown): Promise<ArchiveStudentResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = ArchiveStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  // Don't archive a child who is mid-custody today (on a van or checked in) — they
  // would vanish at once from the dashboard, van rider list, and the table lookup
  // with no warning. Undo their status first. (not_started / checked-out / home /
  // no-show are safe to archive.)
  const today = getLocalDate();
  const admin = createAdminClient();
  const { data: live } = await admin
    .from("student_day_status")
    .select("state")
    .eq("student_id", parsed.data.studentId)
    .eq("event_date", today)
    .maybeSingle<{ state: string }>();
  const LIVE_STATES = new Set([
    "van_boarded_am",
    "arrived_at_site",
    "site_checked_in",
    "van_boarded_pm",
  ]);
  if (live && LIVE_STATES.has(live.state)) {
    return {
      ok: false,
      error: "This child is checked in or on a van right now — undo their status before removing them from rosters.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", parsed.data.studentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}

/**
 * Coordinator-only: restore an archived student back onto the rosters by
 * clearing archived_at. The mirror of archiveStudent.
 */
export async function unarchiveStudent(input: unknown): Promise<ArchiveStudentResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = ArchiveStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ archived_at: null } as never)
    .eq("id", parsed.data.studentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}

// -- Replace a student's photo --

const UpdateStudentPhotoSchema = z.object({
  studentId: z.string().uuid(),
  photoBytes: z.string().min(1, "No photo provided"),
});

/**
 * Coordinator-only: replace a student's photo. Mirrors the registration upload
 * — the client resizes to ≤800px JPEG and sends base64; we write it to the
 * private `student-photos` bucket and point the student at it. Same path per
 * student so a replacement overwrites the old image rather than orphaning it.
 */
export async function updateStudentPhoto(input: unknown): Promise<UpdateStudentResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateStudentPhotoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { studentId, photoBytes } = parsed.data;
  const admin = createAdminClient();

  const { data: student } = await admin
    .from("students")
    .select("family_id")
    .eq("id", studentId)
    .maybeSingle<{ family_id: string }>();
  if (!student) return { ok: false, error: "Student not found" };

  const path = `${student.family_id}/${studentId}.jpg`;
  const bytes = Buffer.from(photoBytes, "base64");
  const { error: uploadErr } = await admin.storage
    .from("student-photos")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { error } = await admin
    .from("students")
    .update({ photo_path: path } as never)
    .eq("id", studentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  return { ok: true };
}

// -- Update student's day record (mode + stops for a single day) --

const UpdateDayRecordSchema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["van", "parent_dropoff_only", "parent_pickup_only", "parent_both"]).optional(),
  morningStopId: z.string().uuid().nullable().optional(),
  afternoonStopId: z.string().uuid().nullable().optional(),
  attending: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Door-to-door: the van assignment (assignStudentToVan) sets stop legs, not
  // this action. A mode-only update is allowed — a van-mode kid with no van yet
  // is intentionally "needs routing", not an error. We only reject an EXPLICIT
  // null on a leg the mode needs (a caller actively clearing a required leg).
  if (!data.mode) return;
  const needsAm = data.mode === "van" || data.mode === "parent_pickup_only";
  const needsPm = data.mode === "van" || data.mode === "parent_dropoff_only";
  if (needsAm && data.morningStopId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This mode requires a morning stop", path: ["morningStopId"] });
  }
  if (needsPm && data.afternoonStopId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This mode requires an afternoon stop", path: ["afternoonStopId"] });
  }
});

export type UpdateDayRecordResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: update a student's day plan — mode, stops, attendance.
 * This is a superset of `updateTodayStops` (in day-record.ts) that also
 * lets coordinators change the transport mode mid-day, e.g. "Mom will pick
 * up today instead of taking the van home."
 */
export async function updateStudentDayRecord(
  input: unknown,
): Promise<UpdateDayRecordResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateDayRecordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { studentId, eventDate, ...fields } = parsed.data;

  const supabase = await createClient();

  // An attendance-only edit doesn't touch the van plan, so it needs no current
  // state. Anything that changes mode or a stop is resolved against the current
  // plan by resolveDayRecordUpdate, which enforces mode↔stop consistency and
  // refuses to disturb the leg a child is currently riding (boarded safety).
  const touchesPlan =
    fields.mode !== undefined ||
    fields.morningStopId !== undefined ||
    fields.afternoonStopId !== undefined;

  let updates: Record<string, unknown>;
  if (!touchesPlan) {
    if (fields.attending === undefined) return { ok: true };
    updates = { attending: fields.attending };
  } else {
    const { data: rec } = await supabase
      .from("student_day_status")
      .select("state, mode, morning_stop_id, afternoon_stop_id")
      .eq("student_id", studentId)
      .eq("event_date", eventDate)
      .maybeSingle<{
        state: string;
        mode: string | null;
        morning_stop_id: string | null;
        afternoon_stop_id: string | null;
      }>();
    if (!rec) return { ok: false, error: "No plan found for this student on this day." };

    const resolved = resolveDayRecordUpdate(
      {
        state: rec.state,
        mode: rec.mode,
        morningStopId: rec.morning_stop_id,
        afternoonStopId: rec.afternoon_stop_id,
      },
      {
        mode: fields.mode,
        morningStopId: fields.morningStopId,
        afternoonStopId: fields.afternoonStopId,
        attending: fields.attending,
      },
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    updates = resolved.updates;
  }

  if (Object.keys(updates).length === 0) return { ok: true };

  const { error } = await supabase
    .from("student_day_records")
    .update(updates as never)
    .eq("student_id", studentId)
    .eq("event_date", eventDate);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}

// -- Assign a student to a van (door-to-door) --

const AssignVanSchema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vanId: z.string().uuid(),
});

export type AssignVanResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: assign a student to a VAN for a single day (door-to-door).
 *
 * Each van is one pickup zone — a `stops` row on its AM/PM routes. Assigning a
 * kid to a van sets both of their stop legs to that van's zone stop, for the
 * legs their current MODE uses (van→both, parent_dropoff_only→PM only,
 * parent_pickup_only→AM only, parent_both→neither). The derived van + wristband
 * color follow automatically via the student_day_status view — we never write
 * them directly.
 *
 * Mode is read from the current plan, not changed here (mode is edited via
 * updateStudentDayRecord). Respects the boarded-stop guard: a kid currently
 * riding a van can't be moved off that leg (it would strip the aide's offload
 * authorization) — undo their boarding first.
 */
export async function assignStudentToVan(
  input: unknown,
): Promise<AssignVanResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = AssignVanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { studentId, eventDate, vanId } = parsed.data;
  const supabase = await createClient();

  // Resolve the van's pickup zone: the single stop on its routes. We read both
  // directions so a van set up with only one direction's route still resolves.
  const { data: routes } = await supabase
    .from("routes")
    .select("stop_ids")
    .eq("van_id", vanId)
    .returns<{ stop_ids: string[] }[]>();
  const zoneStopIds = Array.from(
    new Set((routes ?? []).flatMap((r) => r.stop_ids)),
  );
  if (zoneStopIds.length === 0) {
    return {
      ok: false,
      error: "This van has no pickup zone yet — set its route on the Vans screen first.",
    };
  }
  if (zoneStopIds.length > 1) {
    return {
      ok: false,
      error: "This van's routes cover more than one stop — door-to-door expects one zone per van. Fix its route first.",
    };
  }
  const zoneStopId = zoneStopIds[0]!;

  const { data: rec } = await supabase
    .from("student_day_status")
    .select("state, mode, morning_stop_id, afternoon_stop_id")
    .eq("student_id", studentId)
    .eq("event_date", eventDate)
    .maybeSingle<{
      state: string;
      mode: string | null;
      morning_stop_id: string | null;
      afternoon_stop_id: string | null;
    }>();
  if (!rec) return { ok: false, error: "No plan found for this student on this day." };

  if (!rec.mode) {
    return { ok: false, error: "This student has no transport mode set for today." };
  }

  const updates = assignLegsForVan(rec.mode, zoneStopId, {
    morningStopId: rec.morning_stop_id,
    afternoonStopId: rec.afternoon_stop_id,
  });

  if (Object.keys(updates).length === 0) return { ok: true };

  // Don't move a kid off the van they're currently riding: re-pointing the
  // boarded leg's stop strips the aide's offload authorization. Check the
  // FINAL legs (after the mode-correct assignment) against the current ones.
  const finalMorning =
    updates.morning_stop_id !== undefined ? updates.morning_stop_id : rec.morning_stop_id;
  const finalAfternoon =
    updates.afternoon_stop_id !== undefined ? updates.afternoon_stop_id : rec.afternoon_stop_id;
  const conflict = boardedStopConflict(
    rec.state,
    { morningStopId: rec.morning_stop_id, afternoonStopId: rec.afternoon_stop_id },
    { morningStopId: finalMorning, afternoonStopId: finalAfternoon },
  );
  if (conflict) {
    return {
      ok: false,
      error: `This child is on the ${conflict} van right now — re-assigning them would strip the aide's check-out authority. Undo their boarding first.`,
    };
  }

  const { error } = await supabase
    .from("student_day_records")
    .update(updates as never)
    .eq("student_id", studentId)
    .eq("event_date", eventDate);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}

// -- Set a student's transport MODE for EVERY VBS day --

const UpdateModeAllDaysSchema = z.object({
  studentId: z.string().uuid(),
  mode: z.enum(["van", "parent_dropoff_only", "parent_pickup_only", "parent_both"]),
});

/**
 * Coordinator-only: set a student's transport mode for EVERY VBS day at once
 * (e.g. "parent drops off AM, van home PM" = parent_dropoff_only). Reuses
 * resolveDayRecordUpdate per day so a mode change clears the legs that mode no
 * longer uses (the van assignment then re-points the legs it does use).
 */
export async function updateStudentModeAllDays(input: unknown): Promise<UpdateDayRecordResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = UpdateModeAllDaysSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { studentId, mode } = parsed.data;
  const supabase = await createClient();

  const { data: recs } = await supabase
    .from("student_day_status")
    .select("event_date, state, mode, morning_stop_id, afternoon_stop_id")
    .eq("student_id", studentId)
    .in("event_date", [...VBS_DATES])
    .returns<{
      event_date: string;
      state: string;
      mode: string | null;
      morning_stop_id: string | null;
      afternoon_stop_id: string | null;
    }[]>();
  if (!recs || recs.length === 0) {
    return { ok: false, error: "This student has no plan for the VBS days." };
  }

  for (const rec of recs) {
    const resolved = resolveDayRecordUpdate(
      {
        state: rec.state,
        mode: rec.mode,
        morningStopId: rec.morning_stop_id,
        afternoonStopId: rec.afternoon_stop_id,
      },
      { mode },
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    if (Object.keys(resolved.updates).length === 0) continue;
    const { error } = await supabase
      .from("student_day_records")
      .update(resolved.updates as never)
      .eq("student_id", studentId)
      .eq("event_date", rec.event_date);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}

// -- Assign a student to a van for EVERY VBS day (door-to-door) --

const AssignVanAllDaysSchema = z.object({
  studentId: z.string().uuid(),
  vanId: z.string().uuid(),
});

/**
 * Coordinator-only: put a student on a VAN for EVERY VBS day at once. Used to
 * assign a kid to a region directly — e.g. one whose typed address won't geocode,
 * but whose region the coordinator knows. Resolves the van's single zone, then
 * sets the kid's stop legs (per their mode) on each VBS date. A day where the
 * child is already boarded on a different van is skipped (boarded-stop guard),
 * not failed, so a mid-week reassignment of the remaining days still works.
 */
export async function assignStudentToVanAllDays(input: unknown): Promise<AssignVanResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = AssignVanAllDaysSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { studentId, vanId } = parsed.data;
  const supabase = await createClient();

  const { data: routes } = await supabase
    .from("routes")
    .select("stop_ids")
    .eq("van_id", vanId)
    .returns<{ stop_ids: string[] }[]>();
  const zoneStopIds = Array.from(new Set((routes ?? []).flatMap((r) => r.stop_ids)));
  if (zoneStopIds.length === 0) {
    return { ok: false, error: "This van has no pickup zone yet — set its route on the Vans screen first." };
  }
  if (zoneStopIds.length > 1) {
    return { ok: false, error: "This van's routes cover more than one stop. Fix its route first." };
  }
  const zoneStopId = zoneStopIds[0]!;

  const { data: recs } = await supabase
    .from("student_day_status")
    .select("event_date, state, mode, morning_stop_id, afternoon_stop_id")
    .eq("student_id", studentId)
    .in("event_date", [...VBS_DATES])
    .returns<{
      event_date: string;
      state: string;
      mode: string | null;
      morning_stop_id: string | null;
      afternoon_stop_id: string | null;
    }[]>();
  if (!recs || recs.length === 0) {
    return { ok: false, error: "This student has no plan for the VBS days." };
  }

  for (const rec of recs) {
    if (!rec.mode) continue;
    const updates = assignLegsForVan(rec.mode, zoneStopId, {
      morningStopId: rec.morning_stop_id,
      afternoonStopId: rec.afternoon_stop_id,
    });
    if (Object.keys(updates).length === 0) continue;

    const finalMorning =
      updates.morning_stop_id !== undefined ? updates.morning_stop_id : rec.morning_stop_id;
    const finalAfternoon =
      updates.afternoon_stop_id !== undefined ? updates.afternoon_stop_id : rec.afternoon_stop_id;
    const conflict = boardedStopConflict(
      rec.state,
      { morningStopId: rec.morning_stop_id, afternoonStopId: rec.afternoon_stop_id },
      { morningStopId: finalMorning, afternoonStopId: finalAfternoon },
    );
    if (conflict) continue;

    const { error: updErr } = await supabase
      .from("student_day_records")
      .update(updates as never)
      .eq("student_id", studentId)
      .eq("event_date", rec.event_date);
    if (updErr) return { ok: false, error: updErr.message };
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}
