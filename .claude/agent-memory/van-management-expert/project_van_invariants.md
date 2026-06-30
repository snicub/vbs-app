---
name: project-van-invariants
description: The load-bearing correctness rules of fleet setup under the door-to-door per-van-zone model — verified against code + live DB 2026-06-29. Read before changing vans.ts / lib/vans.ts.
metadata:
  type: project
---

**MODEL DRIFT verified 2026-06-29 (supersedes the "required times" claims below):**
- Zone scheduled times are now **NULL, not required**. `buildZoneStopInsert` (lib/vans.ts) inserts `scheduled_am_time/pm_time = null`; migration 0028 dropped the NOT NULL on `stops`. `CreateVanSchema` requires only name/capacity/plate/colorCode (NO times). The `is_late_am`/`is_in_but_not_out` alarms are **retired** in `anomaly.ts` (deriveAnomalies only returns boarded_but_not_arrived + pm_van_stuck), so NULL times are harmless. The "both times required" / "confirm after backfill" notes are obsolete.
- Driver/aide are now **typed-in names** (migration 0025: `van_assignments.driver_name/aide_name`), set by `setVanAssignment`. The FK cols `driver_user_id/aide_user_id` stay NULL. **The authz fn `_van_assigned_to_user_today` still matches the *_user_id cols** → name assignments carry ZERO authz weight. Fine for this event (kiosk: the van tablet operates as the admin/coordinator, so boarding/offload is authorized via the coordinator branch regardless). Names are display-only.
- **Display split:** `/coordinator/van-rosters` reads driver_name/aide_name (correct, shows them). `/coordinator/vans` (fleet dashboard) still reads the deprecated *_user_id cols → shows "no assignment today" even after names are saved. Cosmetic, but confusing.
- **RLS gating (load-bearing):** `createVan/updateVan/setVanAssignment/ensureVanZones` write through the **cookie-bound RLS client** gated by `_is_coordinator()` (= `public.users.role` by `auth.uid()`). Empirically (2026-06-29) an unauthenticated request has NO coordinator role → writes are REJECTED. So a coordinator/admin **must be signed in** (the no-login synthetic user only satisfies the in-app gate, not the DB session). `deleteVan` is exempt — it uses the admin (service-role) client. This explains why fleet was built via raw SQL.
- Live fleet (2026-06-29): 5 active region vans (Barker Hill/Long Hollows/Old Agency/Peever/Peever Flat), each one zone stop on both am+pm routes, 5 distinct colors, coords set, NO cross-van stop sharing, no orphaned/stranded stops. "Old Agency" = a clean merge of two physical vans onto one region row/zone (capacity 12 = per physical van; 24 riders = 2×12).

**DOOR-TO-DOOR per-van-zone model (2026-06-18, implemented in my slice):** Each van owns exactly ONE pickup zone = a single `stops` row carrying the van's name/color + REQUIRED `scheduled_am_time`/`scheduled_pm_time`, sitting on BOTH the van's AM and PM routes (`stop_ids = [zoneStopId]` for each). A kid rides van X when both their day-record stop legs point to X's zone stop. There are no longer hand-picked shared corner stops for vans; the manual route checklist UI (`route-editor.tsx`) was DELETED. The status view is unchanged — it still derives van+color from routes→stop_ids.
- `createVan` now REQUIRES color + AM + PM time; it inserts the van, then its zone stop, then sets both routes to `[zoneStopId]`. On any failure it rolls back (delete van → cascade drops routes; delete the zone stop explicitly — stops have no FK to vans).
- `updateVan` syncs name/color/AM/PM onto the zone stop (resolved via `zoneStopIdForVan`). Scheduled times must stay non-null or `is_late_am`/`is_in_but_not_out` silently never fire for that van's kids — the manage UI warns on blank times.
- `ensureVanZones()` backfills any pre-existing van that has no zone (default teal color, placeholder 08:00/15:00 the coordinator must then confirm). Idempotent. Surfaced as a "Set up pickup zones" banner on the manage page.
- New pure helpers in `lib/vans.ts` (tested): `isValidTimeOfDay` (HH:MM / HH:MM:SS), `zoneStopIdForVan` (am route stop, fall back to pm), `findVansMissingZone`. `routeStopConflicts` only flags CROSS-van same-direction overlap, so a van's own zone on its am+pm never collides.
- `setVanRoutes`/`orderStopIds` still exist + exported but have no UI consumer now (kept for any programmatic/integration callers).

Fleet setup invariants, confirmed against current code (2026-06-18).

**Why:** A route/assignment mistake silently moves kids (membership is derived) — cost of a bug = a kid unaccounted for.

**How to apply:** Reason about blast radius (rider list → manifest → late-alert → aide authz) before touching any of these.

- `routes` table: `unique(van_id, direction)`, `stop_ids uuid[] not null`, `direction` enum `am|pm`. So a van can have 0, 1, or 2 route rows; a missing PM row and an empty-array PM row are different at the DB level.
- `student_day_status` view derives `morning_van_id`/`afternoon_van_id` via `unnest(stop_ids)` join (am_route/pm_route CTEs in 0005). A stop in two vans' AM `stop_ids` → row multiplication → kid on two manifests + doubled counts. This is exactly what `routeStopConflicts` guards.
- `setVanRoutes` is the only writer that enforces the cross-van guard. It queries OTHER vans' routes (`.neq("van_id", vanId)`) across BOTH directions, runs `routeStopConflicts`, then does a single two-row `upsert(onConflict: van_id,direction)`.
- Deactivation guard in `updateVan`: blocks `active:false` while any route row has non-empty `stop_ids`.
- `van_assignments`: `unique(assignment_date, van_id)`; `setVanAssignment` upserts on that pair. AssignRow is keyed `${date}:${vanId}` so it remounts on date change (no stale overwrite).
- `_van_assigned_to_user_today` reads van_assignments and authorizes driver/aide van events — a missing/wrong assignment = aide gets 42501 and can't board/offload their kids.

Adjacent owners: van-flow (on-the-road), location-routing (address→stop), data-integrity (the authz fn).
