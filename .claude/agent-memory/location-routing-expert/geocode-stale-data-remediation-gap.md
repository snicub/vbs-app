---
name: geocode-stale-data-remediation-gap
description: A geocode-logic fix does NOT self-heal kids already mis-routed — re-running "Suggest from addresses" skips already-geocoded + already-assigned kids. Found 6/30 live.
metadata:
  type: project
---

When a geocoding/region-bucketing bug is fixed, kids routed BEFORE the fix stay on the wrong van. Re-running "Suggest from addresses" (`autoAssignStopsFromAddresses`, `src/server-actions/routing.ts`) is a no-op for them because of two independent skips:

- `routing.ts:127` — families with `lat/lng` already stored are NOT re-geocoded (the wrong coord persists in `families.lat/lng`).
- `routing.ts:165-167` — a kid who already has a `morning_stop_id`/`afternoon_stop_id` has `needsAm/needsPm=false` → `continue` ("already routed"). The wrong zone assignment stays.

The 40-mile sanity guard (`routing.ts:183-198`) gives ZERO protection against region-confusion: the bad point IS a real zone center (0 mi away), so it passes.

**Why:** discovered 2026-06-30 (VBS live) after fixing the town-vs-street bucketing bug (commit f8970f5). Agency Village kids on "barker" streets were on the Barker Hill van; the fix corrected the logic but their stale lat/lng + stop assignments remained.

**How to apply:** after ANY geocode/region fix during the event, the corrected logic only helps NEW/unrouted kids. To remediate already-affected kids: (a) move them on the pickup map `/coordinator/vans/assign` (manual override writes the correct zone directly), or (b) clear their `families.lat/lng` AND both stop legs, then re-run Suggest. There is no automated re-sweep — the coordinator must identify affected kids (e.g. eyeball a suspect van's rider list against home towns). Flag this remediation step explicitly whenever a routing-logic fix lands mid-event.

See [[geocode-region-bucketing]], [[pickup-map]], [[door-to-door-mechanism]].
