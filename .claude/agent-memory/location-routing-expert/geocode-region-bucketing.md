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

- **OPEN GAP — localPlace is deterministic only to the region CENTER, not to a VAN (found in 2026-06-30 adversarial review).** `autoAssignStopsFromAddresses` does NOT map a region→van; it feeds `localPlace`'s hardcoded center into `assignStopsForMode`→`nearestStopId` over ALL routed zone stops (`routing.ts:172-177`, `route-build.ts:21-55`). Zone-stop coords come from the coordinator typing a per-van *area address* geocoded by the EXTERNAL geocoder (`vans.ts:171`), are NULL at van creation (`buildZoneStopInsert`), and are NOT tied to the `LOCAL_TOWNS` centers anywhere — only a manual "keep in sync" comment. Barker Hill (45.581278,-97.061277) and Old Agency (45.56781,-97.06721) centers are ~1.6 km apart, so a slightly-off Barker Hill zone coord can make Old-Agency kids land nearest the Barker-Hill van → silent wrong van (the 6/30 bug relocated). Tests assert only the center (`region-bucketing.test.ts`), never the resulting van. **Fix:** map each region directly to a van/zone-stop id and assign that id, skipping `nearestStopId` for region-matched kids. Scoped to the "Suggest from addresses" path only — signup `regionStopId` and the pickup-map manual `vanId` paths are already deterministic.

- **Door-to-door navigation gap:** for a `LOCAL_TOWNS` address, `geocodeFamilyAddress` stores the region CENTER as the family's lat/lng (`geocode.ts:86-87`), and the driver navigate link prefers lat/lng (`van/[vanId]/page.tsx:116`) → driver routed to the town center, not the house; every kid in that town shares one pin. Street address is on the rider list but isn't what "tap to navigate" uses. Pasted-coordinate + externally-geocodable homes get a real point and are unaffected.

See [[door-to-door-mechanism]], [[geocode-stale-data-remediation-gap]].
