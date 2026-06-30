---
name: null-stop-van-color-derivation
description: Why NULL-stop (address-rework) kids derive NULL van/color/scheduled-time in the view, and what breaks downstream.
metadata:
  type: project
---

The `student_day_status` view (live 0012) derives van + color + scheduled time by **joining the day-record's stop ids to routes/stops**:
- `left join am_route am on am.stop_id = r.morning_stop_id` → `am.van_id as morning_van_id` (0012 lines 369, 322)
- `left join pm_route pm on pm.stop_id = r.afternoon_stop_id` → `afternoon_van_id` (370, 323)
- `left join stops s_am / s_pm` → `scheduled_am_time`, `scheduled_pm_time`, color (371-372, 325-329)

So when a van kid registers with **NULL stops** (the 2026-06-16 address rework writes NULL stops for van kids until a route is built), the view derives **NULL morning_van_id / afternoon_van_id / color / scheduled time**. Confirmed regression. Downstream effects:
- Appears on **no van rider list** (`/van/[vanId]` filters `morning_van_id.eq.X or afternoon_van_id.eq.X`).
- Driver/aide **can't PM-drop-off** them: `_authorize_event` checks `afternoon_van_id = assigned_van`, which is NULL → authz fails.
- `is_late_am` **can't fire** (needs `scheduled_am_time`, which is NULL).
- Name tag prints misleading "P / no van"; dashboard groups them under "Parent drop-off".

The mitigation is the `needsRouting()` worklist (`src/lib/coordinator/dashboard.ts`) surfacing attending van-kids with a null stop so a coordinator assigns one — but that's a worklist, not a fix; until a stop is assigned the kid is invisible to the van flow. The real fix is the address→route builder (owned by location-routing-expert).

**Door-to-door schedule-flag consequence (0028, confirmed 2026-06-29):** under the door-to-door model the per-van pickup-zone `stops` rows are created with NULL `scheduled_am_time`/`scheduled_pm_time` (0028 dropped the NOT NULL so van creation works). The view guards both clock-derived anomalies with `scheduled_*_time is not null` (is_late_am at the view's is_late_am case, is_in_but_not_out at its case), so a null time = no alarm (and `now() > (date + null)` is null-safe anyway). Net effect: **`is_late_am` AND `is_in_but_not_out` are now globally INERT for the whole event** — every afternoon leg points at a null-pm-time zone, so the end-of-day "child still checked in / left behind at site" alarm never fires. is_late_am being off is consistent with the deliberate "remove late alerts" decision (commit ff732c1). The two interval-based flags (is_boarded_but_not_arrived +30m, is_pm_van_stuck +2h) read event timestamps not the schedule and STILL work. If you want an end-of-day never-checked-out net back, it needs a non-schedule trigger.

**Raw-SQL region-van data to verify (structural, durable):** `routes` has `unique(van_id, direction)` (0002:181) so a van holds at most one am + one pm route, but **nothing REQUIRES both** — a van with only an am route makes full-van kids derive `afternoon_van_id = NULL` → aides can't PM-drop-off (authz keys on afternoon_van_id) and the kid drops off the PM rider list. And **nothing structurally prevents the same stop_id appearing in two vans' routes for one direction** (stop_ids is uuid[], no cross-row uniqueness; the app's `routeStopConflicts` guard in `setVanRoutes` is bypassed by raw SQL inserts) → the view's am_route/pm_route unnest matches a kid twice → DUPLICATE view rows → kid double-counted on the dashboard AND on two van lists. Verify region vans have BOTH directions and unique zone stops.

See [[live-function-versions]], [[student-soft-archive]] and [[attending-filter-map]].
