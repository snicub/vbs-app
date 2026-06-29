import "server-only";
import { env } from "@/lib/env";

/**
 * Address → coordinates. Uses Mapbox when MAPBOX_TOKEN is set (fast, no rate
 * limit for our volume), otherwise falls back to free OpenStreetMap Nominatim
 * (fine for a one-time ~100-address batch; the live map is already OSM-based).
 * Returns null on any failure so callers degrade gracefully — a kid who can't
 * be geocoded is flagged for manual routing, never silently dropped.
 */
export type GeoPoint = { lat: number; lng: number };

// The event is in Sisseton, SD. Bias geocoding toward there so a bare street
// name resolves to the local home, not a same-named street in another state.
const SISSETON: GeoPoint = { lat: 45.663, lng: -97.0481 };
// Generous box over NE South Dakota (covers the pickup towns) — used as a *bias*,
// not a hard bound, so a nearby rural address isn't excluded. left,top,right,bottom.
const REGION_VIEWBOX = "-98.4,46.3,-95.8,44.6";

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = query.trim();
  if (!q) return null;
  return env.MAPBOX_TOKEN ? geocodeMapbox(q, env.MAPBOX_TOKEN) : geocodeNominatim(q);
}

/** Build a single-line query from a family's address parts. */
export function familyAddressQuery(f: {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}): string {
  return [f.streetAddress, f.city, f.state, f.postalCode]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
}

async function geocodeMapbox(q: string, token: string): Promise<GeoPoint | null> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${encodeURIComponent(token)}&limit=1&country=us` +
    `&proximity=${SISSETON.lng},${SISSETON.lat}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: { center?: [number, number] }[] };
    const center = data.features?.[0]?.center;
    if (!center) return null;
    const [lng, lat] = center;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

async function geocodeNominatim(q: string): Promise<GeoPoint | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1` +
    `&countrycodes=us&viewbox=${REGION_VIEWBOX}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "vbs-checkin/1.0 (one-time church VBS event)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const first = data[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = Number.parseFloat(first.lat);
    const lng = Number.parseFloat(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}
