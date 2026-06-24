/**
 * Door-to-door van assignment, pure core.
 *
 * Under the door-to-door model each van IS a single pickup zone: a `stops` row
 * that sits on the van's AM and PM routes. A coordinator no longer picks an AM
 * corner and a PM corner independently — they assign the kid to a VAN, and that
 * sets both stop legs to that van's zone stop for the legs the kid's MODE uses:
 *
 *   - van                 → both legs ride the van  → AM + PM = zone stop
 *   - parent_dropoff_only → parent drops at site, van home → PM only = zone stop
 *   - parent_pickup_only  → van to site, parent picks up → AM only = zone stop
 *   - parent_both         → no van ride → neither leg
 *
 * The van + wristband color are DERIVED by the student_day_status view from the
 * resulting stop legs (stop → route → van). We never write the van/color; we
 * write the leg stops, and the view follows on next read.
 *
 * Non-destructive: a leg the mode doesn't use is cleared (a stray stop on an
 * unused leg would keep the child on a ghost van), and only legs that actually
 * change are returned so an unchanged leg is never re-written.
 */

import { ridesMorningVan, ridesAfternoonVan } from "@/lib/routing";

export type VanAssignCurrent = {
  morningStopId: string | null;
  afternoonStopId: string | null;
};

/** snake_case so the result drops straight into a student_day_records update. */
export type VanAssignUpdate = {
  morning_stop_id?: string | null;
  afternoon_stop_id?: string | null;
};

/**
 * Compute the minimal, mode-correct stop-leg update to put a child on the van
 * whose pickup zone is `zoneStopId`. Returns only the legs that change.
 *
 * Legs the mode uses are pointed at the zone stop; legs it doesn't use are
 * cleared to null. The van + color recompute via the view from these legs.
 */
export function assignLegsForVan(
  mode: string,
  zoneStopId: string,
  current: VanAssignCurrent,
): VanAssignUpdate {
  const finalMorning = ridesMorningVan(mode) ? zoneStopId : null;
  const finalAfternoon = ridesAfternoonVan(mode) ? zoneStopId : null;

  const updates: VanAssignUpdate = {};
  if (finalMorning !== current.morningStopId) updates.morning_stop_id = finalMorning;
  if (finalAfternoon !== current.afternoonStopId) updates.afternoon_stop_id = finalAfternoon;
  return updates;
}
