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
// `key` is a token guaranteed to appear in that region's van NAME, so routing can
// match region → the correctly-named van directly (never via nearest coordinate).
const LOCAL_TOWNS: { match: RegExp; key: string; pt: GeoPoint }[] = [
  // Barker Hill — also catch the common "barker bill" / "barkerhill" mistypes.
  { match: /b[ae]rk\w*\s*(hill|bill)/i, key: "barker", pt: { lat: 45.581278, lng: -97.061277 } },
  // BIA Highway/roads run through Long Hollows, so treat "BIA" as Long Hollows.
  { match: /long\s*hollow|\bbia\b/i, key: "hollow", pt: { lat: 45.65316, lng: -97.04586 } },
  // Old Agency is the community of Agency Village, so accept either name — plus
  // Tiospa (Zina), Little Crow Dr, Bernard St, and Max* streets, which are all in
  // Agency Village even when the town is typed as "Sisseton".
  { match: /old\s*agency|agency\s*village|tiospa|little\s*crow|bernard|\bmax/i, key: "agency", pt: { lat: 45.56781, lng: -97.06721 } },
  // Peever + Peever Flat(s) merged into one van — both map to the Peever zone.
  { match: /peever/i, key: "peever", pt: { lat: 45.5391, lng: -96.9578 } },
];

// Catch-all bucket for in-town Sisseton homes that name NO specific reservation
// region — they ride the "Sisseton general" van. Checked LAST so a Sisseton-town
// home on a "Barker Hill" road still goes to Barker Hill.
// /siss/ catches the common mistypes too (sisseton, sisseron, sissteon).
const SISSETON_GENERAL = { match: /siss/i, key: "sisseton", pt: { lat: 45.663, lng: -97.0481 } };

/**
 * The matched local region for an address, in priority order:
 *   1) the TOWN field names a specific region (wins over the street),
 *   2) else the STREET names a specific region,
 *   3) else a Sisseton town/street → the "Sisseton general" bucket.
 * So an "Agency Village" home on a "Barker Hill" road is Old Agency; a "Sisseton"
 * home on a "Barker Hill" road is Barker Hill; a plain Sisseton home is general.
 */
function matchLocalTown(f: AddressParts): { key: string; pt: GeoPoint } | null {
  for (const lt of LOCAL_TOWNS) if (f.city && lt.match.test(f.city)) return lt;
  for (const lt of LOCAL_TOWNS) if (f.streetAddress && lt.match.test(f.streetAddress)) return lt;
  if (
    (f.city && SISSETON_GENERAL.match.test(f.city)) ||
    (f.streetAddress && SISSETON_GENERAL.match.test(f.streetAddress))
  ) {
    return SISSETON_GENERAL;
  }
  return null;
}

/** The region's center coordinate (for the map pin), or null. */
export function localPlace(f: AddressParts): GeoPoint | null {
  return matchLocalTown(f)?.pt ?? null;
}

/** The region's key (a token in its van's name) for direct region→van routing. */
export function localRegionKey(f: AddressParts): string | null {
  return matchLocalTown(f)?.key ?? null;
}

// A pasted "lat, lng" (e.g. straight from Google Maps). Requires ≥3 decimals so a
// plain street number ("45 Main") never reads as a coordinate.
const COORD_RE = /(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/;

/** Parse a Google-Maps-style "lat, lng" out of a string, else null. */
export function parseCoordinate(s: string | null | undefined): GeoPoint | null {
  if (!s) return null;
  const m = COORD_RE.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Geocode a family's home. A known local town (Barker Hill, Long Hollows, Old
 * Agency, Peever Flat) resolves straight to the region center — those names don't
 * geocode externally. Everything else goes through the Sisseton-biased geocoder.
 */
export async function geocodeFamilyAddress(f: AddressParts): Promise<GeoPoint | null> {
  // A pasted "lat, lng" (from Google Maps) is the exact spot — use it directly.
  const coord = parseCoordinate(f.streetAddress) ?? parseCoordinate(f.city);
  if (coord) return coord;
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
