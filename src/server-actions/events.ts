"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { recordEvent } from "@/lib/events/record-event";
import { canUndo } from "@/lib/events/undo";
import type { EventType } from "@/lib/events/state-machine";
import { newIdempotencyKey } from "@/lib/idempotency";
import { clampOccurredAt } from "@/lib/events/occurred-at";
import { getLocalDate } from "@/lib/date";

const EventArgsSchema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventType: z.enum([
    "van_boarded_am",
    "van_offloaded_am",
    "site_checked_in",
    "site_checked_out",
    "van_boarded_pm",
    "van_offloaded_pm",
    "parent_dropoff",
    "parent_pickup",
    "no_show",
    "override",
  ]),
  vanId: z.string().uuid().nullish(),
  stopId: z.string().uuid().nullish(),
  overrideReason: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Optional client-generated key so an offline action replayed from the outbox
  // dedupes to a single event (record_event dedups on idempotency_key).
  idempotencyKey: z.string().min(1).optional(),
  // Optional client capture time so an OFFLINE action records when it actually
  // happened, not when it later syncs — keeps the timeline and the overdue-van
  // anomaly alarms (is_boarded_but_not_arrived, is_pm_van_stuck) honest.
  occurredAt: z.string().datetime().optional(),
});

export type EventActionResult =
  | { ok: true; eventId: string; state: string; wasOverride: boolean }
  | { ok: false; error: string };

/**
 * Single entry point for client-initiated event writes. Verifies the session,
 * delegates to record_event() under the user's role, revalidates the
 * relevant routes.
 */
export async function submitEvent(input: unknown): Promise<EventActionResult> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Not signed in" };

  const parsed = EventArgsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const args = parsed.data;

  // The DB enforces this too, but catching it here lets the UI show a
  // clear message instead of a raw "P0001: override requires reason" error.
  if (args.eventType === "override" && !args.overrideReason?.trim()) {
    return { ok: false, error: "Override requires a written reason." };
  }

  // Drop a future client timestamp (fast van-tablet clock) so it can't silence
  // the overdue-van alarms or reorder the log. See clampOccurredAt.
  const occurredAt = clampOccurredAt(args.occurredAt, Date.now());

  const result = await recordEvent({
    studentId: args.studentId,
    eventDate: args.eventDate,
    eventType: args.eventType as EventType,
    actorUserId: session.id,
    actorRole: session.role,
    idempotencyKey: args.idempotencyKey ?? newIdempotencyKey(args.eventType),
    vanId: args.vanId ?? null,
    stopId: args.stopId ?? null,
    overrideReason: args.overrideReason ?? null,
    metadata: args.metadata,
    occurredAt,
  });

  if (!result.ok) return result;

  // Cascade to layout-scope so dynamic children like /table/[code],
  // /van/[vanId], and /coordinator/students all refresh too.
  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return {
    ok: true,
    eventId: result.data.eventId,
    state: result.data.derivedState,
    wasOverride: result.data.wasOverride,
  };
}

/**
 * Undo a recently-recorded event by inserting an `override` event that
 * supersedes it. Because `_derive_state` filters out override events AND
 * superseded events, the derived state reverts to what it was just before
 * the mistake. The original event row stays for audit.
 *
 * The undo is allowed if:
 *   - the actor is a coordinator/admin, OR
 *   - the actor recorded the event being undone (self-undo, common case)
 *   - AND the event is less than 60 seconds old (after that, force coord override)
 */
const UndoSchema = z.object({
  eventId: z.string().uuid(),
});

export async function undoEvent(input: unknown): Promise<
  { ok: true; newState: string } | { ok: false; error: string }
> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Not signed in" };

  const parsed = UndoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const admin = createAdminClient();
  const { data: original } = await admin
    .from("student_day_events")
    .select("id, student_id, event_date, event_type, actor_user_id, occurred_at, superseded_by_event_id")
    .eq("id", parsed.data.eventId)
    .maybeSingle<{
      id: string;
      student_id: string;
      event_date: string;
      event_type: string;
      actor_user_id: string | null;
      occurred_at: string;
      superseded_by_event_id: string | null;
    }>();

  if (!original) return { ok: false, error: "Event not found" };

  const isCoord = session.role === "coordinator" || session.role === "admin";

  // The "newer non-superseded events exist" guard only applies to
  // non-coordinators; query it lazily so coordinators skip the round-trip.
  // Undoing an earlier event while later ones stand would silently rewrite the
  // audit trail and could leave a historically-impossible state.
  let hasNewerEvents = false;
  if (!isCoord) {
    const { data: newer } = await admin
      .from("student_day_events")
      .select("id")
      .eq("student_id", original.student_id)
      .eq("event_date", original.event_date)
      .gt("occurred_at", original.occurred_at)
      .is("superseded_by_event_id", null)
      .neq("event_type", "override")
      .limit(1);
    hasNewerEvents = !!(newer && newer.length > 0);
  }

  const decision = canUndo(
    {
      eventType: original.event_type,
      actorUserId: original.actor_user_id,
      occurredAt: original.occurred_at,
      supersededByEventId: original.superseded_by_event_id,
    },
    { id: session.id, role: session.role },
    { now: Date.now(), hasNewerEvents },
  );
  if (!decision.ok) return decision;

  const result = await recordEvent({
    studentId: original.student_id,
    eventDate: original.event_date,
    eventType: "override",
    actorUserId: session.id,
    actorRole: session.role,
    idempotencyKey: newIdempotencyKey("undo"),
    overrideReason: `undo: ${original.event_type} at ${original.occurred_at}`,
    supersedesEventId: original.id,
    asAdmin: true,
  });

  if (!result.ok) return result;

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, newState: result.data.derivedState };
}

/**
 * Look up a student by wristband code (case-insensitive after validation).
 * Returns the student's current-day status for the table UI.
 */
const LookupSchema = z.object({
  code: z.string().trim(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function lookupByWristband(input: unknown): Promise<
  | {
      ok: true;
      student: {
        id: string;
        legalFirstName: string;
        legalLastName: string;
        preferredFirstName: string | null;
        wristbandCode: string;
        allergies: string | null;
        medicalNotes: string | null;
        familyId: string;
        photoPath: string | null;
        dob: string | null;
        ageAtRegistration: number | null;
      };
      status: {
        state: string;
        eventDate: string;
        mode: string;
        wristbandColorName: string | null;
        wristbandColorHex: string | null;
        morningStopId: string | null;
        afternoonStopId: string | null;
      } | null;
    }
  | { ok: false; error: string }
> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Not signed in" };

  const parsed = LookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const { validateWristbandCode } = await import("@/lib/wristband/validate");
  const validation = validateWristbandCode(parsed.data.code);
  if (!validation.ok) {
    return {
      ok: false,
      error:
        validation.reason === "checksum"
          ? "That code doesn't check out — likely a typo. Try again."
          : validation.reason === "length"
            ? "Code is 5 characters."
            : "That character isn't on the wristband.",
    };
  }
  const code = validation.normalized;

  const supabase = await createClient();
  const { data: student, error: stuErr } = await supabase
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, family_id, photo_path, dob, age_at_registration")
    .eq("wristband_code", code)
    .is("archived_at", null)
    .maybeSingle<{
      id: string;
      legal_first_name: string;
      legal_last_name: string;
      preferred_first_name: string | null;
      wristband_code: string;
      allergies: string | null;
      medical_notes: string | null;
      family_id: string;
      photo_path: string | null;
      dob: string | null;
      age_at_registration: number | null;
    }>();
  if (stuErr) return { ok: false, error: stuErr.message };
  if (!student) return { ok: false, error: "No student found for that code." };

  const eventDate = parsed.data.eventDate ?? getLocalDate();

  const { data: status } = await supabase
    .from("student_day_status")
    .select("state, event_date, mode, wristband_color_name, wristband_color_for_day, morning_stop_id, afternoon_stop_id")
    .eq("student_id", student.id)
    .eq("event_date", eventDate)
    .maybeSingle<{
      state: string;
      event_date: string;
      mode: string;
      wristband_color_name: string | null;
      wristband_color_for_day: string | null;
      morning_stop_id: string | null;
      afternoon_stop_id: string | null;
    }>();

  return {
    ok: true,
    student: {
      id: student.id,
      legalFirstName: student.legal_first_name,
      legalLastName: student.legal_last_name,
      preferredFirstName: student.preferred_first_name,
      wristbandCode: student.wristband_code,
      allergies: student.allergies,
      medicalNotes: student.medical_notes,
      familyId: student.family_id,
      photoPath: student.photo_path,
      dob: student.dob,
      ageAtRegistration: student.age_at_registration,
    },
    status: status
      ? {
          state: status.state,
          eventDate: status.event_date,
          mode: status.mode,
          wristbandColorName: status.wristband_color_name,
          wristbandColorHex: status.wristband_color_for_day,
          morningStopId: status.morning_stop_id,
          afternoonStopId: status.afternoon_stop_id,
        }
      : null,
  };
}

/**
 * Search students by name fragment (case-insensitive). Returns up to 20 hits.
 * Falls through to admin client so RLS doesn't block table volunteers,
 * but only the minimum identifying fields are returned.
 */
export async function searchStudentsByName(query: string): Promise<
  | { ok: true; matches: { id: string; name: string; wristbandCode: string }[] }
  | { ok: false; error: string }
> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Not signed in" };

  const { isStaff } = await import("@/lib/auth/roles");
  if (!isStaff(session.role)) return { ok: false, error: "Staff only" };

  const q = query.trim().toLowerCase();
  if (q.length < 2) return { ok: true, matches: [] };

  const sanitized = q.replace(/[.,%_*()\\]/g, "");
  if (sanitized.length < 2) return { ok: true, matches: [] };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
    .is("archived_at", null)
    .or(
      `legal_first_name.ilike.%${sanitized}%,legal_last_name.ilike.%${sanitized}%,preferred_first_name.ilike.%${sanitized}%`,
    )
    .limit(20)
    .returns<{
      id: string;
      legal_first_name: string;
      legal_last_name: string;
      preferred_first_name: string | null;
      wristband_code: string;
    }[]>();

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    matches: (data ?? []).map((s) => ({
      id: s.id,
      name: `${s.preferred_first_name ?? s.legal_first_name} ${s.legal_last_name}`,
      wristbandCode: s.wristband_code,
    })),
  };
}
