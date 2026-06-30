---
name: address-routing-state
description: Current state of the address→route layer as of 2026-06-16 — route builder + geocoding now BUILT, the no-address flag surface, Mapbox/Nominatim fallback, and what's still open.
metadata:
  type: project
---

State of the address-and-routing layer, verified against code 2026-06-16 (second pass — the builder + geocoding landed since the first pass).

**Geocoding: BUILT.** `src/lib/geocode.ts` `geocodeAddress(query)` uses Mapbox when `MAPBOX_TOKEN` set (`src/lib/env.ts:23`, still `.optional()`), else falls back to free OSM **Nominatim**. Returns null on any failure → caller flags the kid, never drops. `familyAddressQuery` joins street/city/state/postal into one line. The live map is still Leaflet/OSM (separate concern).
**When does it run:** ONLY inside the coordinator's "Build from addresses" button, NOT at register/edit. `registerFamily` writes address text but leaves `families.lat/lng` NULL until the button geocodes + persists them. Deliberate (batch-on-demand; avoids slowing signup + Nominatim rate limits). `families` has `lat/lng` columns (0002:55-56).

**Route builder: BUILT — DOOR-TO-DOOR (van = zone).** Each van has ONE pickup "zone" = a `stops` row on its AM+PM route carrying the van's color + area lat/lng. Assigning a kid to the nearest zone == nearest VAN; both legs point at the same zone so derived `morning_van_id == afternoon_van_id`. There are no shared corner stops — vans drive to each home.
- Pure math: `src/lib/route-build.ts` — `nearestStopId` (haversine) + `assignStopsForMode` (NON-destructive: fills only the empty legs the kid's mode needs, never overrides a coordinator's manual stop). For `mode === "van"` it anchors BOTH legs to ONE zone: if either leg is already pinned, the empty leg follows it (never re-computed by distance → can't split a van kid across two vans); else both go to nearest. `stops` passed in MUST already be filtered to routable van-zone stops. Unit-tested (`tests/unit/route-build.test.ts`, 11 tests).
- Action: `src/server-actions/routing.ts` `autoAssignStopsFromAddresses({eventDate})` — coordinator-gated; routes ALL VBS days in one pass. Candidate zones = stops that are on a van route (from `routes.stop_ids`) AND have coords — a stop not on any route is excluded so a kid is never pointed at a stop that derives NO van. Two distinct failure messages: no routed stops at all → "set up vans and their pickup zones first, or assign vans manually"; routed stops but none have coords → "set each van's area location first, or assign vans manually". Geocodes address-less van families (batch 8, cap 75/run, persists lat/lng), returns `{geocoded, assigned, flagged, pending}`. Address-less / geocode-failed kids counted as `flagged` (distinct students, deduped), never placed.
- UI: dashboard "Build from addresses" button (coordinator-ops' slice — do NOT touch). Heuristic is nearest-zone only (no clustering/TSP/route-order optimization yet) — fine as interim.

**Van/color derivation (unchanged, still correct):** `student_day_status` view (latest = 0012) joins `morning_stop_id`/`afternoon_stop_id` against `routes.stop_ids` → `morning_van_id`/`afternoon_van_id`; coalesces afternoon→morning stop color for `wristband_color_for_day`. NULL stop → NULL van → no rider list. Stops + colors stay the unit.

**No-address / unrouted flag surface — BUILT and UNIFIED (B1 fixed):** `needsRouting(row)` now lives in `src/lib/routing.ts` (van-based: directional by mode, NULL van id on a required leg = unrouted). Imported by ALL three surfaces — coordinator worklist (`/coordinator/page.tsx`), paper failsafe roster (`src/lib/failsafe/print-data.ts`), name tags (`src/lib/nametags/tag-data.ts`). The old disjoint dashboard-vs-roster definitions are gone (`src/lib/coordinator/dashboard.ts` no longer owns it). Worklist rows deep-link to `/coordinator/students/[id]/edit` (mode-gated AM/PM stop selects → `updateStudentDayRecord`).

**Still open (see [[address-routing-gaps]]):** address itself is not editable post-signup (`updateFamilyContacts` is phone/emergency only); geocoding doesn't auto-run; Nominatim batch may throttle. RESOLVED since last pass: builder now routes all VBS days (not single-date); the "assigned can still be a null-van kid if the stop isn't on a route" hole is closed — candidate zones are filtered to routed stops only.

**How to apply:** the address→geocode→stop→van path works end-to-end and is reviewable/overridable by the coordinator. Remaining work is B2 multi-day, address editing + re-geocode, and (later) real road routing/ETA via Mapbox Directions Matrix.
