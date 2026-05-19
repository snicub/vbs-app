"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";

const Schema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  morningStopId: z.string().uuid().nullable(),
  afternoonStopId: z.string().uuid().nullable(),
});

/**
 * Coordinator-only: change a student's planned morning/afternoon stop for a
 * single day. Used when a family calls ahead: "please drop my kid at Maple
 * Town Hall today instead of Riverside Coffee."
 *
 * The derived van assignment + wristband color recompute automatically via the
 * student_day_status view; no event log entry is needed because we're changing
 * the PLAN, not recording an event.
 */
export async function updateTodayStops(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator only" };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bad input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_day_records")
    .update({
      morning_stop_id: parsed.data.morningStopId,
      afternoon_stop_id: parsed.data.afternoonStopId,
    } as never)
    .eq("student_id", parsed.data.studentId)
    .eq("event_date", parsed.data.eventDate);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator");
  revalidatePath(`/table`, "layout");
  return { ok: true };
}
