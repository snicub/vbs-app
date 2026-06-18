"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { splitName } from "@/lib/registration/schema";
import { resolveDayRecordUpdate } from "@/lib/day-record-plan";

// -- Update student profile (name, allergies, medical notes) --

const UpdateStudentSchema = z.object({
  studentId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").optional(),
  allergies: z.string().trim().optional(),
  medicalNotes: z.string().trim().optional(),
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
  const updates: Record<string, string | null> = {};
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

// -- Update student's day record (mode + stops for a single day) --

const UpdateDayRecordSchema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["van", "parent_dropoff_only", "parent_pickup_only", "parent_both"]).optional(),
  morningStopId: z.string().uuid().nullable().optional(),
  afternoonStopId: z.string().uuid().nullable().optional(),
  attending: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.mode) return;
  const needsAm = data.mode === "van" || data.mode === "parent_pickup_only";
  const needsPm = data.mode === "van" || data.mode === "parent_dropoff_only";
  if (needsAm && !data.morningStopId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This mode requires a morning stop", path: ["morningStopId"] });
  }
  if (needsPm && !data.afternoonStopId) {
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
