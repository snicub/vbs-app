"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { boardedStopConflict, planRegionMove } from "@/lib/routing";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { VBS_DATES } from "@/lib/registration/dates";

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

  const supabase = createAdminClient();

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

const SetVanSchema = z.object({
  studentId: z.string().uuid(),
  vanId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type DayRec = {
  mode: string;
  state: string;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  attending: boolean;
};

/**
 * Coordinator-only: put a child on a given van by pointing the legs their mode
 * rides at that van's pickup zone. Applied to the viewed day AND every later VBS
 * day, so one tap from the driver sheet fixes the wrong-van assignment for the
 * rest of the event (past days are left as history). Each day re-derives its own
 * mode/state and is guarded so a child who is currently ON that leg's van isn't
 * re-pointed out from under the aide. The derived van/color/roster recompute via
 * the status view — no event is recorded (this changes the PLAN, not state).
 */
export async function setStudentVan(
  input: unknown,
): Promise<{ ok: true; appliedDays: number } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator only" };
  }
  const parsed = SetVanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bad input" };
  const { studentId, vanId, eventDate } = parsed.data;

  const supabase = createAdminClient();

  const { data: routes } = await supabase
    .from("routes")
    .select("van_id, direction, stop_ids")
    .eq("van_id", vanId)
    .returns<DirectionRoute[]>();
  const zoneStopId = zoneStopIdForVan(vanId, routes ?? []);
  if (!zoneStopId) {
    return { ok: false, error: "That van has no pickup zone set up yet — set its area first." };
  }

  // The viewed day and every later VBS day (don't rewrite history).
  const dates = VBS_DATES.filter((d) => d >= eventDate);
  let appliedDays = 0;
  for (const d of dates) {
    const { data: rec } = await supabase
      .from("student_day_status")
      .select("mode, state, morning_stop_id, afternoon_stop_id, attending")
      .eq("student_id", studentId)
      .eq("event_date", d)
      .maybeSingle<DayRec>();
    if (!rec || !rec.attending) continue;

    const plan = planRegionMove(
      rec.mode,
      rec.state,
      { morningStopId: rec.morning_stop_id, afternoonStopId: rec.afternoon_stop_id },
      zoneStopId,
    );
    if (plan.action === "noop") {
      appliedDays++;
      continue;
    }
    if (plan.action === "boarded-conflict") {
      return {
        ok: false,
        error: `This child is on the ${plan.leg} van right now (${d}) — undo their boarding before moving them.`,
      };
    }
    const { error } = await supabase
      .from("student_day_records")
      .update({ morning_stop_id: plan.morningStopId, afternoon_stop_id: plan.afternoonStopId } as never)
      .eq("student_id", studentId)
      .eq("event_date", d);
    if (error) return { ok: false, error: error.message };
    appliedDays++;
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true, appliedDays };
}
