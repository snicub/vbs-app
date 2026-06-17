"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { boardedStopConflict } from "@/lib/routing";

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

  // One read of the derived status gives the current mode, stops, and event
  // state — enough for both safety guards below.
  const { data: rec } = await supabase
    .from("student_day_status")
    .select("mode, state, morning_stop_id, afternoon_stop_id")
    .eq("student_id", parsed.data.studentId)
    .eq("event_date", parsed.data.eventDate)
    .maybeSingle<{
      mode: string;
      state: string;
      morning_stop_id: string | null;
      afternoon_stop_id: string | null;
    }>();
  if (rec) {
    // Don't re-point the van out from under an aide mid-ride: changing the stop
    // for a leg the child is currently on would strip the aide's offload authz.
    const conflict = boardedStopConflict(
      rec.state,
      { morningStopId: rec.morning_stop_id, afternoonStopId: rec.afternoon_stop_id },
      { morningStopId: parsed.data.morningStopId, afternoonStopId: parsed.data.afternoonStopId },
    );
    if (conflict) {
      return {
        ok: false,
        error: `This child is on the ${conflict} van right now — changing their ${conflict} stop would strip the aide's check-out authority. Undo their boarding first.`,
      };
    }

    // Guard against clearing a stop the child's mode still needs — a van kid
    // left without the matching stop silently falls off every van (and gets no
    // late alert). Mirrors the consistency check in updateStudentDayRecord.
    const needsAm = rec.mode === "van" || rec.mode === "parent_pickup_only";
    const needsPm = rec.mode === "van" || rec.mode === "parent_dropoff_only";
    if (needsAm && !parsed.data.morningStopId) {
      return { ok: false, error: "This child's mode needs a morning stop." };
    }
    if (needsPm && !parsed.data.afternoonStopId) {
      return { ok: false, error: "This child's mode needs an afternoon stop." };
    }
  }

  const { error } = await supabase
    .from("student_day_records")
    .update({
      morning_stop_id: parsed.data.morningStopId,
      afternoon_stop_id: parsed.data.afternoonStopId,
    } as never)
    .eq("student_id", parsed.data.studentId)
    .eq("event_date", parsed.data.eventDate);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  return { ok: true };
}
