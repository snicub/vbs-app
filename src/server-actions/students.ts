"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";

// -- Update student profile (name, allergies, medical notes) --

const UpdateStudentSchema = z.object({
  studentId: z.string().uuid(),
  preferredFirstName: z.string().trim().optional(),
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
  if (fields.preferredFirstName !== undefined) {
    updates.preferred_first_name = fields.preferredFirstName || null;
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

  const updates: Record<string, unknown> = {};
  if (fields.mode !== undefined) updates.mode = fields.mode;
  if (fields.morningStopId !== undefined) updates.morning_stop_id = fields.morningStopId;
  if (fields.afternoonStopId !== undefined) updates.afternoon_stop_id = fields.afternoonStopId;
  if (fields.attending !== undefined) updates.attending = fields.attending;

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const supabase = await createClient();
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
