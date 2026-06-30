---
name: door-to-door-auto-assign-correctness
description: How door-to-door auto-assign maps a kid to a van, the one correctness risk (zone-stop coordinate coherence), and the safe corrective-SQL pattern for mis-bucketing.
metadata:
  type: project
---

Door-to-door van assignment correctness, verified 2026-06-30 (live-event day 1; mis-bucketing was the day's biggest issue).

**How a kid lands on a van:** `localPlace` (`src/lib/geocode.ts:55-59`) classifies a family to a fixed region CENTER by TOWN first, street second (LOCAL_TOWNS `:38-46`: barker hill/bill, long hollow, old agency|agency village, peever incl. flat). `autoAssignStopsFromAddresses` (`src/server-actions/routing.ts`) auto-assigns ONLY region-matched kids; no-region kids are FLAGGED (`:167-171`), never assigned. `assignStopsForMode` then picks the NEAREST routable zone stop to that center (`src/lib/route-build.ts:48-73`). So the van a town maps to = whichever van-zone stop's DB coordinates are nearest that town's center.

**THE risk (not in code — runtime DB state):** if a van's zone-stop lat/lng isn't nearest its own region center, a WHOLE town silently routes to the wrong van. Old Agency center (45.56781,-97.06721) and Barker Hill center (45.581278,-97.061277) are only ~1.5 km apart — easy to cross if a coordinator placed a zone stop loosely. This is the likely root cause of mis-bucketing. A wrong-van kid is NOT "lost" (still on a rider list) but is a real safety problem, and the late/never-out alarms WON'T catch it (both inert — see [[null-stop-van-color-derivation]], 0028 null zone times). Verify: for each region, nearest van-zone stop to its LOCAL_TOWNS center == that region's own van.

**Auto-assign is idempotent / non-destructive:** fills only empty legs (`needsAm/needsPm` gate routing.ts:157-159; `assignStopsForMode` coalesces; writes only on diff :178-191), van kid gets both legs the SAME zone (never split), never un-assigns. Re-running "Suggest" is safe. Touches ONLY `student_day_records` (the plan) — never the append-only event log; view derives van/color from the stop (0026 `:91-92,97-98`).

**Safe corrective-SQL pattern for mis-bucketing:** UPDATE `student_day_records` set the right stop, guarded by `not exists (events for that student,date)`. This is STRICTER than `boardedStopConflict` (routing.ts:62-74) — it skips ANY day with any event, so a kid already boarded/checked-in today is untouched (no authz strip, no mid-custody move) while their future-day records are corrected. Custody/state derive purely from events, so unchanged. Must-verify literals: (1) target stop_id is a real zone stop on the destination van's am AND pm routes (else null van → drops off all lists); (2) student_id lists are the right kids (the events guard does NOT protect a not_started kid from a mistyped UUID); (3) set only the legs the kid's mode rides (a stray morning_stop on a parent_dropoff_only kid puts them on an AM rider list they don't ride).

See [[live-function-versions]], [[null-stop-van-color-derivation]], [[door-to-door-zone-model]].
