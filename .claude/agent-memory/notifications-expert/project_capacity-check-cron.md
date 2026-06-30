---
name: capacity-check-cron
description: The day-before FAMILY reminder cron was replaced by capacity-check — a coordinator-ONLY van-over-capacity text at 7PM Central, no family messages.
metadata:
  type: project
---

As of 2026-06-18 `src/app/api/cron/capacity-check/route.ts` replaced the deleted day-before family reminder. It runs `0 0 * * *` (00:00 UTC = 19:00 America/Chicago, the evening before), reads tomorrow's DERIVED van loads from `student_day_status` (filtered `attending = true`), counts AM + `morning_van_id` and PM + `afternoon_van_id` per van, and if any active van's count exceeds its `capacity` texts ONLY `COORDINATOR_PHONE` (templateKey `capacity_alert`). No family-facing message exists on any schedule anymore.

Safety properties confirmed at go-live review:
- **Fails closed:** no `CRON_SECRET` → 503; wrong `Authorization: Bearer` → 401. Same gate as anomaly-watch.
- **No opt-out concern:** the only recipient is the coordinator, not families — STOP-filtering is N/A here.
- **Over-capacity math:** strict `>` (exactly at capacity is NOT flagged), matching the `/coordinator/vans` page display logic. Pure version is unit-tested in `tests/unit/capacity.test.ts` (`findOver`), though the route's own aggregation is inlined (not imported from a shared lib).
- **`getLocalTomorrow`** is timezone-correct (`APP_TIMEZONE`, default America/Chicago); fires at 7PM so the local-clock date-arithmetic is nowhere near a midnight boundary.

`vercel.json` now has exactly two crons: capacity-check (`0 0 * * *`) and anomaly-watch (`*/5 11-23 * * *`).

**Why:** the family day-before reminder was judged unnecessary noise; the real prior-evening value is catching an over-stuffed van before the morning. Coordinator-only keeps it out of the opt-out/STOP surface entirely.

**How to apply:** when asked about scheduled family messages, there are NONE — only two coordinator-only crons. The capacity route's aggregation is NOT the shared `findOver` test helper; if you change the math, update both. See [[project_status-link-delivery]] for the one remaining family send (confirmation SMS).
