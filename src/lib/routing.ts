/**
 * Canonical routing rules, shared by the coordinator "needs routing" worklist,
 * the Sunday-night paper failsafe roster, and the morning name tags. Keeping one
 * definition here is the fix for divergent copies that disagreed on which kids
 * were unrouted (the dashboard flagged a missing stop; the paper roster flagged
 * a missing van — so a freshly-registered van kid with no stop slipped through
 * the roster and printed as "Parent drop-off").
 *
 * Van membership is DERIVED from the stop→route join (exposed as morning_van_id
 * / afternoon_van_id on the student_day_status view), never stored. So the one
 * safety question that matters is: will a child who needs a van actually be on
 * one? A null van id answers "no" — whether because no stop is assigned yet, or
 * the assigned stop isn't on any van's route — and that child must be surfaced,
 * never silently dropped from a van.
 */

/** Modes whose child boards the morning van. */
export function ridesMorningVan(mode: string | null): boolean {
  return mode === "van" || mode === "parent_pickup_only";
}

/** Modes whose child boards the afternoon van. */
export function ridesAfternoonVan(mode: string | null): boolean {
  return mode === "van" || mode === "parent_dropoff_only";
}

export type RoutingRow = {
  mode: string | null;
  morningVanId: string | null;
  afternoonVanId: string | null;
  attending: boolean;
};

/**
 * True when a van leg the child requires has no van resolved. Directional by
 * mode: a parent-pickup-only kid needs only the morning van, a
 * parent-dropoff-only kid only the afternoon van, a van kid both. Parent-both
 * and non-attending kids never need routing.
 */
export function needsRouting(r: RoutingRow): boolean {
  if (!r.attending || !r.mode) return false;
  return (
    (ridesMorningVan(r.mode) && !r.morningVanId) ||
    (ridesAfternoonVan(r.mode) && !r.afternoonVanId)
  );
}

type StopPair = {
  morningStopId: string | null;
  afternoonStopId: string | null;
};

/**
 * A stop change is unsafe while the child is currently ON the van for that leg.
 * The van is DERIVED from the stop, and the aide's check-out authorization keys
 * on that derived van — so re-pointing the stop out from under a boarded child
 * would strip the aide holding them of the authority to record their offload,
 * stranding the child mid-ride. Returns the conflicting leg, or null when the
 * change is safe (the child isn't on that leg's van yet — e.g. a pre-board
 * call-ahead re-route). Only the leg actually being changed is checked.
 */
export function boardedStopConflict(
  state: string,
  current: StopPair,
  next: StopPair,
): "morning" | "afternoon" | null {
  if (state === "van_boarded_am" && next.morningStopId !== current.morningStopId) {
    return "morning";
  }
  if (state === "van_boarded_pm" && next.afternoonStopId !== current.afternoonStopId) {
    return "afternoon";
  }
  return null;
}

export type RegionMovePlan =
  | { action: "move"; morningStopId: string | null; afternoonStopId: string | null }
  | { action: "noop" }
  | { action: "boarded-conflict"; leg: "morning" | "afternoon" };

/**
 * Decide how to re-point a child's van legs onto a target pickup zone. Only the
 * legs the child's mode actually rides are moved — the other leg is left exactly
 * as-is (a parent-dropoff-only kid keeps their untouched morning). Returns
 * "noop" when the rider already sits on that zone for every leg they ride (or
 * rides no van at all), and "boarded-conflict" when the move would re-point a
 * leg the child is currently boarded on — the caller must skip it and undo the
 * boarding first, so the aide holding the child keeps check-out authority.
 *
 * Shared by the one-tap driver-sheet "Move to van" and the bulk "re-check vans
 * from address rules" sweep, so both apply the identical leg + boarding safety.
 */
export function planRegionMove(
  mode: string | null,
  state: string,
  current: StopPair,
  zoneStopId: string,
): RegionMovePlan {
  const nextMorning = ridesMorningVan(mode) ? zoneStopId : current.morningStopId;
  const nextAfternoon = ridesAfternoonVan(mode) ? zoneStopId : current.afternoonStopId;
  if (nextMorning === current.morningStopId && nextAfternoon === current.afternoonStopId) {
    return { action: "noop" };
  }
  const conflict = boardedStopConflict(state, current, {
    morningStopId: nextMorning,
    afternoonStopId: nextAfternoon,
  });
  if (conflict) return { action: "boarded-conflict", leg: conflict };
  return { action: "move", morningStopId: nextMorning, afternoonStopId: nextAfternoon };
}
