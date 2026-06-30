---
name: capacity-cron-rename
description: The van over-capacity alert cron was renamed to /api/cron/capacity-check; still texts the coordinator
metadata:
  type: project
---

The van over-capacity alert cron lives at `/api/cron/capacity-check/route.ts` (renamed from an earlier "over-capacity" name as of the 2026-06-18 go-live pass).

**Why:** It's the staff-safety alert that checks tomorrow's DERIVED van loads (AM + PM) against each active van's `capacity` and, if over, texts `env.COORDINATOR_PHONE` ("VBS capacity alert for <date>: <Van AM: n/cap, ...>"). No family-facing message. Scheduled `0 0 * * *` UTC = 19:00 America/Chicago (evening before).

**How to apply:** This file is notifications-expert's domain (Twilio/cron), not ours — but it surfaces a coordinator-facing alert, so know it exists when reasoning about how a coordinator learns a van is overbooked. If asked "how does the coordinator find out a van is too full," the answer is this cron's SMS, not a dashboard card.
