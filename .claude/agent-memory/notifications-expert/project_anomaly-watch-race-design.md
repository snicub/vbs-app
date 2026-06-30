---
name: anomaly-watch-race-design
description: How the anomaly-watch cron achieves once-per-(student,date,kind) safety and how the W8 lib extraction is wired
metadata:
  type: project
---

The anomaly-watch cron (`src/app/api/cron/anomaly-watch/route.ts`) sends one coordinator SMS per open anomaly, deduped per (student, date, kind), and is safe to run every 5 min on overlapping ticks.

**Why:** Vvan/anomaly alerts fire repeatedly while a condition stays open; without dedup the coordinator gets spammed and may tune out a real "kid unaccounted for" alert. Concurrent Vercel ticks could double-text.

**How to apply (the load-bearing mechanism):**
- Dedup ledger = `anomaly_notifications` table (migration `0016`), PRIMARY KEY `(student_id, event_date, anomaly_kind)`. That PK *is* the race guard.
- The route uses **claim-then-send**: INSERT the ledger row FIRST; a unique-violation means another tick won, so skip the SMS. On Twilio failure it DELETEs the claim so the next tick retries. This is correct — do not "optimize" it into send-then-record (that reintroduces double-texts and lost retries).
- W8 extraction: the pair-explosion + dedup-filter are pure functions in `src/lib/notifications/anomaly-watch.ts` (`anomalyPairs`, `unnotifiedPairs`); `tests/unit/anomaly-watch.test.ts` imports the REAL functions the route uses. The route still owns the claim/send/ledger I/O. Verified behaviorally identical to pre-extraction.

Related: day-before cron uses a different dedup (by-family in-memory Map + cross-run `notifications_sent` lookup on `created_at`), NOT this ledger. See [[notifications-known-gaps]].
