/**
 * Pure routing math: given a child's home coordinates, pick the stop(s) for the
 * van legs their mode requires. No DB/network here so the rules are directly
 * unit-testable. Assignment is NON-destructive — it only fills a leg that's
 * empty, never overrides a stop a coordinator already chose.
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
 * The stops to store for a child, filling only the empty legs their mode needs
 * with the stop nearest their home. A van kid gets both legs; a
 * parent-pickup-only kid only the morning leg; a parent-dropoff-only kid only
 * the afternoon leg; parent-both is untouched.
 */
export function assignStopsForMode(
  point: { lat: number; lng: number },
  stops: StopPoint[],
  mode: string | null,
  current: { morningStopId: string | null; afternoonStopId: string | null },
): { morningStopId: string | null; afternoonStopId: string | null } {
  if (stops.length === 0) return current;
  const nearest = nearestStopId(point, stops);
  return {
    morningStopId:
      ridesMorningVan(mode) && !current.morningStopId ? nearest : current.morningStopId,
    afternoonStopId:
      ridesAfternoonVan(mode) && !current.afternoonStopId ? nearest : current.afternoonStopId,
  };
}
