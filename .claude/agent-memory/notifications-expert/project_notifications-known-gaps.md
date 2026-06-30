---
name: notifications-known-gaps
description: Known/accepted gaps in the notifications + cron surface; refreshed 2026-06-29 pre-event review (door-to-door null scheduled times kill 2 of 4 anomaly alerts).
metadata:
  type: project
---

State of the notifications + scheduled-jobs surface as of the 2026-06-29 pre-event review. Load-bearing safety properties still hold: signature verification on all three webhooks, fail-closed CRON_SECRET (503 when unset, 401 on mismatch), idempotent anomaly-watch (claim-then-send on the `anomaly_notifications` PK). Only two cron routes exist now (`capacity-check`, `anomaly-watch`); there is NO family-facing scheduled send — see [[capacity-check-cron]] and [[status-link-delivery]].

**Biggest structural gap — half the anomaly alerts are permanently dead:**
- The door-to-door rework creates each van's pickup-zone stop with `scheduled_am_time: null` / `scheduled_pm_time: null` (`src/lib/vans.ts` `buildZoneStopInsert` ~line 55-56; columns made nullable in migration 0028). The `student_day_status` view (latest def in migration 0026) gates `is_late_am` on `s_am.scheduled_am_time is not null` and `is_in_but_not_out` on `s_pm.scheduled_pm_time is not null`. With times always null, **both flags can never be true.**
- Net effect for anomaly-watch: it can ONLY ever fire on `is_boarded_but_not_arrived` (30 min after AM boarding, interval off the real boarding timestamp) and `is_pm_van_stuck` (2h after PM boarding). Those DO catch a kid lost in transit. But a kid who is a **no-show / never boards the AM van produces zero automated alert** (that was `is_late_am`'s job), and a kid who checks in at site but **never checks out produces zero alert** (`is_in_but_not_out`). The coordinator must catch those by eye on `/coordinator`.
- This is a routing/van-management design consequence (null times by design), not a notifications bug. Restoring those two alerts requires populating zone scheduled times — coordinate with van-management-expert + data-integrity-expert, don't patch the view solo.

**Still-true residual gaps (none blocker):**
- **Anomaly flags 2/3/4 are not `attending`-gated in the view** (only `is_late_am` checks `r.attending`). A non-attending kid with a stray boarded/checked-in event would still alert. Edge case.
- **Resend webhook does not verify svix-timestamp freshness** (no replay window). Low risk. NOTE: no email is ever actually SENT by the app (no `resend.emails.send` anywhere; only `sendSms` exists) — the Resend webhook updates statuses for messages that never go out. Dead but harmless.
- **TEST-COVERAGE structural gap:** the signature validators (`validateTwilioSignature` duplicated inline in twilio/inbound + twilio/status; `validateResendSignature` inline in resend/webhook) live INSIDE the route handlers — not exported, not unit-testable as-is. Extract to pure libs first (same pattern as `anomaly-watch.ts`), then unit-test (Twilio param sort-order independence + Resend multi-sig `.some()` path are the subtle assertions). `tests/integration/` is still empty.

**Resolved since the 2026-06-17 version of this note (do not re-flag as open):**
- Anomaly TZ math no longer uses the session GUC — pinned to `America/Chicago` in migration 0020, carried verbatim through 0023 + 0026.
- The day-before family reminder cron + its cross-run/by-family dedup are GONE (route + template + test deleted ~2026-06-18). Any note about "day-before dedup-by-family" is obsolete.

**Why:** so a future pass doesn't re-discover the dead `is_late_am`/`is_in_but_not_out` as a notifications bug, and doesn't re-flag the already-fixed TZ/day-before items.
**How to apply:** if asked "will a missing kid alert," the honest answer is only-once-boarded; a no-show is silent automation-wise. If asked to add webhook-signature tests, extract the inline validators first.
