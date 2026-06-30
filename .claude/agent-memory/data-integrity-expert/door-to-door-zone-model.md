---
name: door-to-door-zone-model
description: Verified door-to-door transport model — one per-van "zone" stop on AM+PM route; GO with one gotcha (zone stop must carry the event AM/PM scheduled times for is_late_am).
metadata:
  type: project
---

Door-to-door transport rework. Design-verified 2026-06-18; **IMPLEMENTATION reviewed 2026-06-18** (vans.ts, students.ts assignStudentToVan, van-assign.ts, route-build.ts, routing.ts, dashboard.ts). Verdict: GO. **No migration required** — reuses stops/routes/the view (0023) exactly as-is.

**Implementation facts (verified against code):**
- The zone stop is created by `provisionVanZone` (vans.ts) with `name=town=color_name=van name`, the van's color, and AM/PM times. `setVanRouteStops` upserts BOTH route rows to `stop_ids:[zoneStopId]` (onConflict van_id,direction). `createVan` rolls back (delete van → cascades routes; delete stop) on any failure.
- **The is_late_am NULL-time gotcha is now CLOSED at the schema level:** `stops.scheduled_am_time`/`scheduled_pm_time` are `time NOT NULL` (0002), `provisionVanZone` always supplies both, `TimeSchema` (vans.ts) validates HH:MM. A zone stop with null times is impossible. Backfill (`ensureVanZones`) uses placeholder 08:00/15:00 the coordinator must confirm.
- `assignStudentToVan` (students.ts) resolves the van's zone by deduping ALL its route stop_ids; rejects 0 zones ("no pickup zone yet") and >1 zones ("more than one stop"). `assignLegsForVan` (van-assign.ts) writes only the mode-correct legs (van→both, dropoff_only→PM, pickup_only→AM, parent_both→neither) and clears unused legs. Re-checks `boardedStopConflict` on FINAL legs before writing.
- `routes.van_id → vans(id) ON DELETE CASCADE`; `student_day_records.{morning,afternoon}_stop_id → stops(id) ON DELETE RESTRICT` (0014). There is NO deleteVan action — coordinators deactivate. The only van delete is the createVan rollback (which also deletes its stop). So routine operation never orphans a zone stop.
- dashboard.ts now filters attending in BOTH computeMetrics AND computeVanBreakdown (rollup keyed by derived vanId; null van → "Parent drop-off"). The dashboard attending-inconsistency is resolved for this surface.

**Open items found in the implementation review (not blockers):**
- `setVanRoutes` (vans.ts, the multi-stop route editor action) is now DEAD — route-editor.tsx was deleted, nothing calls it. Carries the only `routeStopConflicts` caller.
- `ensureVanZones` + `createVan` are NOT concurrency-guarded: two simultaneous backfills/creates can each insert a distinct zone stop, second route-upsert wins → one ORPHAN zone stop (a stops row on no route). Harmless to derivation (orphan derives no van; ON DELETE RESTRICT just blocks deleting it) but clutters the stop list. Low severity (single coordinator).
- Pre-existing (NOT door-to-door): coordinator write actions (vans.ts, students.ts, stops.ts, day-record.ts) use the cookie-bound `createClient()` whose RLS keys on `auth.uid()`. Under ALLOW_NO_LOGIN kiosk mode there is no PG session → `_is_coordinator()` is false → these writes are rejected at the DB. Door-to-door follows the existing convention, so it's not a regression.

Original design-verification notes below.

**The model:** each van gets ONE "zone" `stops` row, placed on that van's AM route AND PM route, carrying the van's color + the event AM/PM scheduled times. A kid assigned to a van = both `morning_stop_id` and `afternoon_stop_id` point to that van's zone stop. The van drives door-to-door; the zone is just the grouping.

**Verdict: GO**, with one operational gotcha (not a code bug):

1. **Van derivation works.** `student_day_status` (0023, lines 50-58, 87-88, 135-136) derives `morning_van_id`/`afternoon_van_id` by `unnest`ing `routes.stop_ids` per direction and joining `stop_id = morning/afternoon_stop_id`. Both legs → the same zone stop → on that van's AM and PM route → `morning_van_id = afternoon_van_id = that van`. Correct.
2. **Color = single band.** `wristband_color_for_day = coalesce(s_pm.color_code, s_am.color_code)` (0023 line 93). Both legs are the same zone stop → AM color == PM color → single band, no two-color edge. Name tags only print a split AM|PM band when `morningColorCode != afternoonColorCode` (`tag-data.ts` buildTagData), which can't happen here.
3. **routeStopConflicts ALLOWS same-van AM+PM.** `setVanRoutes` queries OTHER routes only (`.neq("van_id", vanId)`, vans.ts) and `routeStopConflicts` (lib/vans.ts) only flags a stop on a DIFFERENT van same-direction. One zone on its own van's am+pm is never a conflict. Confirmed.
4. **needsRouting still correct.** `needsRouting` (lib/routing.ts) is van-id based: flags a van kid (mode `van`/`parent_pickup_only`/`parent_dropoff_only`) whose required leg has a null derived van id. No zone assigned → null stop → null van → flagged. Zone assigned → derived van → clears. Correct.
5. **is_late_am — THE GOTCHA (operational, not code).** `is_late_am` reads `s_am.scheduled_am_time` off the morning stop = the zone stop (0023 lines 90, 100-103, join 137). So **each van's zone stop MUST carry a non-null `scheduled_am_time` (and `scheduled_pm_time` for is_in_but_not_out)**, set to the event AM/PM times. If a zone stop is created with null scheduled times, the late-arrival and never-checked-out alerts silently never fire for that whole van — the same null-scheduled-time failure mode as the address-rework regression ([[null-stop-van-color-derivation]]). The math itself works; it just depends on the data being populated. Make scheduled times required when creating a zone stop.
6. **Other surfaces — all clear.** Capacity counters BOTH count by derived van id, not stop id (`/coordinator/vans/page.tsx` lines 63-72; `/api/cron/capacity-check` lines 45-50) — so all of a van's riders sharing one zone stop count correctly into that one van. RLS: coordinator can create/edit zone stops (`stops_coord_write` `for all using _is_coordinator()`, 0006). `boardedStopConflict` (lib/routing.ts) still guards a mid-ride stop change. No `record_event`/`smart_checkout`/event-log change — append-only + authz untouched (authz keys on the derived afternoon_van_id, which now resolves correctly).

**Net:** the zone model is a pure data-shape choice on existing tables; the derivation, guards, counts, and RLS all already handle it. The only real action item is item 5 (populate scheduled times on zone stops). See [[live-function-versions]] and [[null-stop-van-color-derivation]].
