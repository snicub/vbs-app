/**
 * Pure routing math for the DOOR-TO-DOOR model. Each van has ONE pickup "zone"
 * = a `stops` row that sits on the van's AM and PM route and carries the van's
 * color + area coordinates. Assigning a kid to a van means pointing BOTH their
 * legs at that van's zone, so the derived morning_van_id == afternoon_van_id.
 * "Nearest stop" therefore literally means "nearest van."
 *
 * No DB/network here so the rules are directly unit-testable. Assignment is
 * NON-destructive — it only fills a leg that's empty, never overrides a stop a
 * coordinator already chose.
 *
 * Candidate stops are ONLY zone stops that are actually on a van route. A stop
 * with coordinates that isn't on any route must never be a target: pointing a
 * leg at it would derive a NULL van and silently un-route the child.
 */
import { haversineMeters } from "@/lib/geo";
import { ridesMorningVan, ridesAfternoonVan } from "@/lib/routing";

export type StopPoint = { id: string; lat: number; lng: number };

export function nearestStopId(
  point: { lat: number; lng: number },
  stops: StopPoint[],
): string | null {
  let best: string | null = null;
  let bestMeters = Number.POSITIVE_INFINITY;
  for (const s of stops) {
    const d = haversineMeters(point.lat, point.lng, s.lat, s.lng);
    if (d < bestMeters) {
      bestMeters = d;
      best = s.id;
    }
  }
  return best;
}

/**
 * The zone stops to store for a child, filling only the empty legs their mode
 * needs with the zone nearest their home. `stops` MUST already be filtered to
 * routable van-zone stops by the caller.
 *
 * A van kid is put on ONE van — both legs point at the same zone. If a
 * coordinator has already pinned one leg, the empty leg is anchored to that
 * SAME zone (not re-computed by distance) so the child can't end up split
 * across two vans. A parent-pickup-only kid only gets the morning leg, a
 * parent-dropoff-only kid only the afternoon leg, parent-both is untouched.
 */
export function assignStopsForMode(
  point: { lat: number; lng: number },
  stops: StopPoint[],
  mode: string | null,
  current: { morningStopId: string | null; afternoonStopId: string | null },
): { morningStopId: string | null; afternoonStopId: string | null } {
  if (stops.length === 0) return current;
  const nearest = nearestStopId(point, stops);

  // A full-van kid rides ONE van: if either leg is already pinned, the other
  // empty leg follows it; otherwise both go to the nearest zone.
  if (mode === "van") {
    const zone = current.morningStopId ?? current.afternoonStopId ?? nearest;
    return {
      morningStopId: current.morningStopId ?? zone,
      afternoonStopId: current.afternoonStopId ?? zone,
    };
  }

  return {
    morningStopId:
      ridesMorningVan(mode) && !current.morningStopId ? nearest : current.morningStopId,
    afternoonStopId:
      ridesAfternoonVan(mode) && !current.afternoonStopId ? nearest : current.afternoonStopId,
  };
}
