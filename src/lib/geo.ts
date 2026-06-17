/**
 * Geographic helpers: haversine distance + a naive straight-line ETA based on
 * average van speed (parent status page only). This is crow-flies × 1.4, not
 * road routing, so it can mislead on real road networks. MAPBOX_TOKEN is wired
 * up elsewhere (geocoding in geocode.ts) but is deliberately NOT used here —
 * these ETAs stay dependency-free and offline-safe.
 */

const EARTH_RADIUS_M = 6_371_000;
const AVG_VAN_MPS = 11; // ~25 mph — a rough urban/rural mix for the church area

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Naive ETA in seconds from straight-line distance. Inflates by 1.4x to
 * approximate driving-vs-crow-flies, then divides by AVG_VAN_MPS.
 *
 * Returns null if either point is missing.
 */
export function estimatedEtaSeconds(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return null;
  }
  const meters =
    haversineMeters(fromLat as number, fromLng as number, toLat as number, toLng as number) * 1.4;
  return Math.round(meters / AVG_VAN_MPS);
}

/** Human-friendly ETA — "8 min", "1 hr 5 min", or "<1 min". */
export function formatEta(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return "<1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours} hr ${remMin} min`;
}
