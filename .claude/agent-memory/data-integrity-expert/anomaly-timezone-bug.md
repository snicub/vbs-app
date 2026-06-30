---
name: anomaly-timezone-bug
description: is_late_am and is_in_but_not_out use the mutable session timezone GUC, not a fixed zone. Confirmed unfixed 2026-06-16.
metadata:
  type: project
---

The clock-time anomaly flags in the `student_day_status` view (live in 0012) compute the deadline as `(event_date + scheduled_time) at time zone current_setting('TIMEZONE')`. Confirmed at 0012 lines **337** (`is_late_am`) and **354** (`is_in_but_not_out`).

`current_setting('TIMEZONE')` is the **mutable session timezone GUC**. Migration 0013 pins it at the DB level (`ALTER DATABASE postgres SET timezone='America/Chicago'`), but any session or pooler that issues `SET timezone` silently shifts these two flags — making "kid is late" and "never checked out" fire at the wrong wall-clock time, or not fire. Supabase's pooler / PostgREST can set a session TZ.

**Should be hard-coded** `at time zone 'America/Chicago'` in the view (a fix is a new migration that redefines the view, plus re-run pgTAP). The interval-based anomalies (`is_boarded_but_not_arrived` = +30min, `is_pm_van_stuck` = +2h) are immune — they compare `now()` to a stored `occurred_at`, no zone math.

This also affects the `/api/cron/anomaly-watch` SMS alerts, which read the same flags from the view.

See [[live-function-versions]].
