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

type AddressParts = {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

// Local reservation/town names the external geocoder does NOT recognize — an
// address using one of these as its town would fail to geocode (or worse, match a
// same-named street far away). Each maps to the region's center, so the home
// resolves to the right region/van. The driver still navigates by the full street
// address shown on the rider list. Keep these in sync with the van zones.
const LOCAL_TOWNS: { match: RegExp; pt: GeoPoint }[] = [
  // Barker Hill — also catch the common "barker bill" mistype. Checked first so a
  // "barker …" street wins even when the town field says something else.
  { match: /b[ae]rk\w*\s*(hill|bill)/i, pt: { lat: 45.581278, lng: -97.061277 } },
  { match: /long\s*hollow/i, pt: { lat: 45.65316, lng: -97.04586 } },
  // Old Agency is the community of Agency Village, so accept either name.
  { match: /old\s*agency|agency\s*village/i, pt: { lat: 45.56781, lng: -97.06721 } },
  { match: /peever\s*flat/i, pt: { lat: 45.54375, lng: -96.95493 } },
];

/** If the address's town/street names a known local region, return its center. */
export function localPlace(f: AddressParts): GeoPoint | null {
  const hay = `${f.city ?? ""} ${f.streetAddress ?? ""}`;
  for (const lt of LOCAL_TOWNS) if (lt.match.test(hay)) return lt.pt;
  return null;
}

/**
 * Geocode a family's home. A known local town (Barker Hill, Long Hollows, Old
 * Agency, Peever Flat) resolves straight to the region center — those names don't
 * geocode externally. Everything else goes through the Sisseton-biased geocoder.
 */
export async function geocodeFamilyAddress(f: AddressParts): Promise<GeoPoint | null> {
  const local = localPlace(f);
  if (local) return local;
  const q = familyAddressQuery(f);
  return q ? geocodeAddress(q) : null;
}

/** Build a single-line query from a family's address parts. */
export function familyAddressQuery(f: AddressParts): string {
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
