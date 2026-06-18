/**
 * Pure resolver for a coordinator edit to a student's day plan (mode / stops /
 * attendance). This is the single tested home for two safety invariants that
 * were previously enforced by ad-hoc inline logic in the server action:
 *
 *  1. Mode↔stop consistency. The van a child rides is DERIVED from their stop
 *     (via the route), independent of `mode`. So a leg the final mode doesn't
 *     use must NOT keep a stop, or the child stays on a ghost van manifest.
 *  2. Boarded safety. Never disturb the leg a child is currently riding — the
 *     aide's check-out authority keys on the derived van, so re-pointing (or
 *     clearing) that leg's stop, or switching the mode so that leg drops its
 *     van, would strip the aide of the authority to record the offload and
 *     strand the child mid-ride.
 *
 * Both reduce to one check once the FINAL (mode-normalized) stops are computed:
 * boardedStopConflict on the final stops catches an explicit stop change AND a
 * mode change that clears the boarded leg's stop.
 */

import { ridesMorningVan, ridesAfternoonVan, boardedStopConflict } from "@/lib/routing";

export type DayPlanCurrent = {
  state: string;
  mode: string | null;
  morningStopId: string | null;
  afternoonStopId: string | null;
};

export type DayPlanPatch = {
  mode?: string;
  morningStopId?: string | null;
  afternoonStopId?: string | null;
  attending?: boolean;
};

/** snake_case so the result drops straight into a student_day_records update. */
export type DayPlanUpdate = {
  mode?: string;
  morning_stop_id?: string | null;
  afternoon_stop_id?: string | null;
  attending?: boolean;
};

export type DayPlanResolution =
  | { ok: true; updates: DayPlanUpdate }
  | { ok: false; error: string; conflict: "morning" | "afternoon" };

/**
 * Resolve a partial patch against the current plan into a minimal, safe update.
 * Returns the columns that actually change (so an unchanged field is never
 * written), or a boarded conflict the caller must surface and refuse.
 */
export function resolveDayRecordUpdate(
  current: DayPlanCurrent,
  patch: DayPlanPatch,
): DayPlanResolution {
  const finalMode = patch.mode ?? current.mode;

  let finalMorning =
    patch.morningStopId !== undefined ? patch.morningStopId : current.morningStopId;
  let finalAfternoon =
    patch.afternoonStopId !== undefined ? patch.afternoonStopId : current.afternoonStopId;

  // A leg the final mode doesn't use can't keep a stop (van is derived from it).
  if (!ridesMorningVan(finalMode)) finalMorning = null;
  if (!ridesAfternoonVan(finalMode)) finalAfternoon = null;

  // One check covers both an explicit stop change and a mode change that clears
  // the boarded leg's stop, because both move the FINAL stop for that leg.
  const conflict = boardedStopConflict(
    current.state,
    { morningStopId: current.morningStopId, afternoonStopId: current.afternoonStopId },
    { morningStopId: finalMorning, afternoonStopId: finalAfternoon },
  );
  if (conflict) {
    const leg = conflict === "morning" ? "morning" : "afternoon";
    return {
      ok: false,
      conflict,
      error: `This child is on the ${leg} van right now — changing their ${leg} stop or switching them off the van would strip the aide's check-out authority. Undo their boarding first.`,
    };
  }

  const updates: DayPlanUpdate = {};
  if (patch.mode !== undefined && patch.mode !== current.mode) updates.mode = patch.mode;
  if (patch.attending !== undefined) updates.attending = patch.attending;
  if (finalMorning !== current.morningStopId) updates.morning_stop_id = finalMorning;
  if (finalAfternoon !== current.afternoonStopId) updates.afternoon_stop_id = finalAfternoon;

  return { ok: true, updates };
}
