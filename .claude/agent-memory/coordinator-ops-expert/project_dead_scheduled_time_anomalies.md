---
name: dead-scheduled-time-anomalies
description: is_late_am and is_in_but_not_out never fire — van zones carry NULL scheduled times AND anomaliesFor() suppresses them. Only the 2 van-transit anomalies are live.
metadata:
  type: project
---

Of the four anomaly flags, only **`is_boarded_but_not_arrived`** and **`is_pm_van_stuck`** ever surface. `is_late_am` and `is_in_but_not_out` are doubly dead:
1. `src/lib/anomaly.ts` `anomaliesFor()` explicitly drops both ("retired: relied on per-van scheduled times").
2. Even at the DB, the view (0023) gates both on `scheduled_am_time`/`scheduled_pm_time IS NOT NULL`, but van pickup zones are created with NULL times (`src/lib/vans.ts:55-56`; 0028 made stops schedule nullable). So the view returns false anyway.

**Why:** Door-to-door dropped per-stop scheduled times; there's no global AM start time.

**How to apply:** Three "stuck" end-of-day states raise NO alert in "Needs attention": a never-arrived kid (`not_started`, the old `is_late_am` catch), a checked-in-never-out kid (`site_checked_in`), and a checked-out-never-home kid (`site_checked_out`). The needs-routing card copy promising kids "get the late-arrival alert" after van assignment (`page.tsx` ~line 258) is misleading — no late alert exists. Only kid-on-a-vehicle cases are alerted. See [[closeout-announcements-removed]].
