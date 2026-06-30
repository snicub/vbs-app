---
name: door-to-door-van-assign
description: Door-to-door model — each van is one pickup zone (a stops row on its routes); assignStudentToVan + assignLegsForVan helper; how the edit screen assigns a kid to a van instead of picking AM/PM corners
metadata:
  type: project
---

Door-to-door transport: each van IS a single pickup zone — a `stops` row that sits on the van's AM and PM `routes` (`routes.stop_ids`). No DB migration; the existing stop-leg columns carry the assignment.

**The model (verified against the view):** the `student_day_status` view derives `morning_van_id` from `morning_stop_id → am_route.van_id` and `afternoon_van_id` from `afternoon_stop_id → pm_route.van_id` (`am_route`/`pm_route` = `unnest(routes.stop_ids)` per direction). So assigning a kid to van X = both stop legs point to X's zone stop, for the legs the kid's MODE uses. Van + `wristband_color_for_day` follow automatically — NEVER write them.

**Mode → which legs ride the van** (the matrix `assignLegsForVan` encodes, via `ridesMorningVan`/`ridesAfternoonVan` in routing.ts):
- `van` → BOTH legs = zone stop
- `parent_pickup_only` → AM only (morning = zone, afternoon cleared to null)
- `parent_dropoff_only` → PM only (afternoon = zone, morning cleared)
- `parent_both` → neither (both cleared — no van ride)

**`assignLegsForVan(mode, zoneStopId, current)`** — pure, in `src/lib/van-assign.ts`, tested (van-assign.test.ts, 8 tests full matrix + minimal-patch). Returns ONLY the legs that change (snake_case keys for a direct `student_day_records` update). Clears unused legs (a stray stop on an unused leg = ghost van).

**`assignStudentToVan(studentId, eventDate, vanId)`** — server action in students.ts, coordinator-gated (cookie-bound client, RLS-enforced). Flow: resolve the van's zone = the single stop across its `routes.stop_ids` (rejects 0 zones "set its route first" / >1 zones "fix its route"); read `state, mode, morning/afternoon_stop_id` from the view; reject if no day-record / no mode; compute legs via `assignLegsForVan`; **run `boardedStopConflict` against the FINAL legs** (boarded guard STILL applies — `van_boarded_am`→morning, `van_boarded_pm`→afternoon, "undo their boarding first"); write only changed legs. Mode is NOT changed here (mode lives in `updateStudentDayRecord`).

**Edit screen:** the AM/PM corner-stop `<Select>`s are GONE. Transport is now (a) attending+mode via `updateStudentDayRecord`, (b) a separate "Assign to a van" section (only when mode rides a van) with a van `<Select>` + the kid's CURRENT van shown (derived in the page from stop→van index, PM-then-AM precedence). The page now fetches `vans` + `routes`, builds `zoneByVan`/`vanByStop`, and passes `vanOptions` (active vans with exactly one resolved zone) + `currentVanId`.

**`updateStudentDayRecord` zod relaxed (2026-06-18):** its stop-requirement superRefine now only fires on an EXPLICIT `null` for a needed leg (`=== null`), not on an omitted leg (`!data.stop`). Reason: under door-to-door the form sends mode-only (no stop fields); the van assignment sets legs separately. A van-mode kid with no van yet is intentionally "needs routing", not a validation error. `resolveDayRecordUpdate` still clears unused legs on a mode downgrade and still enforces the boarded guard. `updateStudentDayRecord`'s ONLY caller is this edit form, so the relaxation is contained.

**KNOWN BUG (found 2026-06-18 review, edit page zone resolution):** `[studentId]/edit/page.tsx` builds `zoneByVan` by looping route ROWS and `if (!zoneByVan.has(van_id)) set(...)` — so for a van with two route rows (am + pm) only the FIRST row wins, and the `routes` select has no ordering → nondeterministic. The ACTION (`assignStudentToVan`) flattens `stop_ids` across ALL the van's route rows then requires exactly one. So page (per-row) and action (cross-row) can DISAGREE: the page can show a wrong/empty zone or offer a van the action rejects. Display-only (action re-validates, authoritative), but fix the page to mirror the action: collect stop_ids across all of a van's route rows, dedupe, `length===1` = zone.

**Orphaned corner-stop picker NOT on my surface but contradicts door-to-door:** `src/app/table/[code]/change-stops.tsx` (`ChangeStopsPanel`) is the OLD independent AM/PM stop-dropdown UI, still MOUNTED on `/table/[code]/page.tsx` and still calling `updateTodayStops` (day-record.ts). It's the check-in-flow-expert's surface. If door-to-door retires independent corner-picking everywhere, `change-stops.tsx` + `updateTodayStops` become dead. Coordinate before deleting.

**Test gap:** `assignLegsForVan` is fully tested; `assignStudentToVan` itself (zone 0/1/>1 branches + the final-leg boarded-conflict OVERLAY at students.ts ~287, merging partial updates back onto current before the guard) has NO test. Extract the overlay into a pure helper + test to lock the boarded guard.

Related: [[roster-surface-map]] (boarded-strand mechanism, client choices), [[name-rule-and-edit-screen]].
