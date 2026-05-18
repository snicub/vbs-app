"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { recordEvent } from "@/lib/events/record-event";
import type { EventType } from "@/lib/events/state-machine";
import { newIdempotencyKey } from "@/lib/idempotency";

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

  const result = await recordEvent({
    studentId: args.studentId,
    eventDate: args.eventDate,
    eventType: args.eventType as EventType,
    actorUserId: session.id,
    actorRole: session.role,
    idempotencyKey: newIdempotencyKey(args.eventType),
    vanId: args.vanId ?? null,
    stopId: args.stopId ?? null,
    overrideReason: args.overrideReason ?? null,
    metadata: args.metadata,
  });

  if (!result.ok) return result;

  revalidatePath("/coordinator");
  revalidatePath("/table");
  revalidatePath("/van", "layout");

  return {
    ok: true,
    eventId: result.data.eventId,
    state: result.data.derivedState,
    wasOverride: result.data.wasOverride,
  };
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
      };
      status: {
        state: string;
        eventDate: string;
        wristbandColorName: string | null;
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
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, family_id, photo_path")
    .eq("wristband_code", code)
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
    }>();
  if (stuErr) return { ok: false, error: stuErr.message };
  if (!student) return { ok: false, error: "No student found for that code." };

  const eventDate = parsed.data.eventDate ?? new Date().toISOString().slice(0, 10);

  const { data: status } = await supabase
    .from("student_day_status")
    .select("state, event_date, wristband_color_name, morning_stop_id, afternoon_stop_id")
    .eq("student_id", student.id)
    .eq("event_date", eventDate)
    .maybeSingle<{
      state: string;
      event_date: string;
      wristband_color_name: string | null;
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
    },
    status: status
      ? {
          state: status.state,
          eventDate: status.event_date,
          wristbandColorName: status.wristband_color_name,
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

  const q = query.trim().toLowerCase();
  if (q.length < 2) return { ok: true, matches: [] };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
    .or(
      `legal_first_name.ilike.%${q}%,legal_last_name.ilike.%${q}%,preferred_first_name.ilike.%${q}%`,
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
