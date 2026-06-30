import { haversineMeters } from "@/lib/geo";

export type PickupRider = {
  lat: number | null;
  lng: number | null;
  /** Street address, used to group kids at the same home into one stop. */
  addressKey: string;
};

export type PickupStop<T> = { riders: T[]; lat: number; lng: number };

// Van hub: First Baptist Church, Sisseton SD — the vans dispatch from here, so
// the pickup route is ordered outward from this point.
const HUB = { lat: 45.663, lng: -97.0481 };

/**
 * Turn a van's riders into an efficient pickup sequence:
 *  - kids at the same address become ONE stop (pick them all up together),
 *  - stops are pre-sorted by address (so a region whose homes share one geocoded
 *    point still comes out in sensible street order), seeded nearest-neighbour
 *    from the church hub, then improved with a 2-opt pass that minimises the full
 *    round trip (hub → every home → back to hub). 2-opt removes the route
 *    crossings and the long drive-back-from-the-farthest-stop that plain
 *    nearest-neighbour leaves behind.
 * Riders with no coordinates can't be routed and are returned separately.
 */
export function orderPickup<T extends PickupRider>(
  riders: T[],
  hub: { lat: number; lng: number } = HUB,
): { stops: PickupStop<T>[]; unlocated: T[] } {
  const located: T[] = [];
  const unlocated: T[] = [];
  for (const r of riders) {
    if (r.lat != null && r.lng != null) located.push(r);
    else unlocated.push(r);
  }

  const groups = new Map<string, T[]>();
  for (const r of located) {
    const key = r.addressKey.trim().toLowerCase() || `${r.lat},${r.lng}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let pending: PickupStop<T>[] = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([, rs]) => ({
      riders: rs,
      lat: rs[0]!.lat as number,
      lng: rs[0]!.lng as number,
    }));

  const seed: PickupStop<T>[] = [];
  let cur = hub;
  while (pending.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i]!;
      const d = haversineMeters(cur.lat, cur.lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const next = pending[bestI]!;
    seed.push(next);
    cur = { lat: next.lat, lng: next.lng };
    pending = pending.filter((_, i) => i !== bestI);
  }

  return { stops: twoOptRoundTrip(seed, hub), unlocated };
}

/** Length of the round trip hub → every stop in order → back to hub. */
function roundTripMeters<T>(
  order: PickupStop<T>[],
  hub: { lat: number; lng: number },
): number {
  let total = 0;
  let prev = hub;
  for (const s of order) {
    total += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return total + haversineMeters(prev.lat, prev.lng, hub.lat, hub.lng);
}

/**
 * 2-opt local search: repeatedly reverse the stop sub-sequence between two
 * positions whenever doing so shortens the round trip, until no reversal helps.
 * A strict-improvement guard (no change accepted unless it beats the current
 * tour by more than EPS) keeps the seed order on ties — so a flattened region
 * whose homes share one coordinate stays in its street-address order. The fleet
 * is a handful of stops per van, so the simple O(n³) sweep is instant.
 */
export function twoOptRoundTrip<T>(
  order: PickupStop<T>[],
  hub: { lat: number; lng: number },
): PickupStop<T>[] {
  const EPS = 1e-6;
  if (order.length < 3) return order;
  let best = order;
  let bestLen = roundTripMeters(best, hub);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const len = roundTripMeters(candidate, hub);
        if (len + EPS < bestLen) {
          best = candidate;
          bestLen = len;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Split ordered pickup stops into `n` balanced, contiguous loads — one per driver
 * crew on the region. Stops are kept whole (a household isn't split) and the
 * pickup order is preserved, so each crew gets a geographic chunk. Always returns
 * exactly `n` arrays (some may be empty if there are fewer stops than crews).
 */
export function splitStopsIntoLoads<T>(stops: PickupStop<T>[], n: number): PickupStop<T>[][] {
  if (n <= 1) return [stops];
  const total = stops.reduce((sum, s) => sum + s.riders.length, 0);
  const target = Math.max(1, Math.ceil(total / n));
  const loads: PickupStop<T>[][] = [];
  let cur: PickupStop<T>[] = [];
  let curCount = 0;
  for (const s of stops) {
    cur.push(s);
    curCount += s.riders.length;
    if (curCount >= target && loads.length < n - 1) {
      loads.push(cur);
      cur = [];
      curCount = 0;
    }
  }
  loads.push(cur);
  while (loads.length < n) loads.push([]);
  return loads;
}

/**
 * Parse comma-separated driver and aide name fields into positional crews
 * (driver 1 + aide 1, driver 2 + aide 2, …). Empty input → no crews.
 */
export function parseCrews(
  driver: string | null,
  aide: string | null,
): { driver: string; aide: string }[] {
  const ds = (driver ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const as = (aide ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Math.max(ds.length, as.length);
  const crews: { driver: string; aide: string }[] = [];
  for (let i = 0; i < n; i++) crews.push({ driver: ds[i] ?? "", aide: as[i] ?? "" });
  return crews;
}
