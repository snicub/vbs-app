---
name: geocode-region-bucketing
description: How home addresses map to a van region — signup region dropdown (primary), localPlace town-first reservation mapping, parseCoordinate, and the stale-data remediation gap from the 6/30 live bug.
metadata:
  type: project
---

The event is in Sisseton, SD on the Lake Traverse reservation. Homes map to a van region by THREE paths (in `src/lib/geocode.ts` `geocodeFamilyAddress`, order: coord → localPlace → external geocode):

1. **Signup "Pickup region" dropdown (primary, since commit fcb79ea ~2026-06-27).** Parent picks the region at signup → `regionStopId` (a van zone stop UUID) written straight to the legs in `registerFamily` (`src/server-actions/registration.ts:206-208`): `van`→both legs, `parent_pickup_only`→AM, `parent_dropoff_only`→PM. Skips geocoding entirely. Public signup form only emits `van` or `parent_both` (`signup-form.tsx:143`), so signup van kids get BOTH legs. No region picked → null legs → needs-routing flag (safe).
2. **`localPlace` reservation-name mapping** for the 4 community names external geocoders don't recognize: `LOCAL_TOWNS` regexes → hardcoded region centers — barker hill/bill, long hollow, old agency|agency village, peever flat. Each is a van zone center; driver still navigates by the full street on the rider list.
3. **External geocode** (Mapbox if token, else OSM Nominatim, Sisseton-biased) for everything else (e.g. plain Sisseton).

**Why:** door-to-door means a kid must land on the nearest van *region*; these communities aren't geocodable by name, so they're hardcoded.

**How to apply:**
- **localPlace is TOWN-FIRST** (`geocode.ts:55-59`, fixed 2026-06-30 commit f8970f5 after a real wrong-van bug): checks `city` against every region pattern first, only falls to `streetAddress` if no town matches. A region-naming town ALWAYS wins over a street keyword (Agency Village home on a "barker" road → Old Agency). Don't reorder this. Walk cases pinned in `tests/unit/local-place.test.ts`.
- **`parseCoordinate`** accepts a pasted Google-Maps "lat,lng" (needs ≥3 decimals so a house number never reads as a coord; swapped lng,lat is rejected because lng≈-97 fails abs>90 — safe for THIS region only). Used directly as the home point when present in street or city.
- **Residual mis-bucket (accepted):** street-fallback fires before external geocode, so an in-town home on a road merely *named* "Barker Hill Rd"/"Long Hollow Rd" buckets to that region. The team treats a region word in the street = that region (Della case is intended-correct).

See [[door-to-door-mechanism]], [[geocode-stale-data-remediation-gap]].
