---
name: attending-filter-map
description: Which screens filter attending=true vs not, on the student_day_status view. Source of count inconsistency.
metadata:
  type: project
---

The `student_day_status` view does NOT filter `attending` itself — each reader decides. Map re-verified 2026-06-17: the count-correctness inconsistency the charter named is now RESOLVED.

**Count-correctness screens — all filter `attending=true` (consistent):**
- `/van/[vanId]` page.tsx:63 — `.eq("attending", true)`.
- `/coordinator/nametags`, `/coordinator/print` — filtered.
- Coordinator dashboard **cards** — `computeMetrics`/`computeTownBreakdown` (`src/lib/coordinator/dashboard.ts:41,72`) `.filter(r => r.attending)`.
- `/coordinator` main roster LIST + header count — page.tsx:136 `.filter((s) => dayRecMap.get(s.student_id)?.attending ?? true)`; comment at :130 explicitly ties it to the cards. (Was inconsistent; FIXED.)
- `/coordinator/closeout` anomaly snapshot — page.tsx:73 `.eq("attending", true)`. (Was unfiltered; FIXED by the "closeout attending filter" commit.)

**Intentionally NOT filtered (correct — not count-correctness surfaces):**
- `/coordinator/students` list — full roster management; non-attending kids SHOULD show so a coordinator can edit them.
- `/api/cron/anomaly-watch` + `src/lib/notifications/anomaly-watch.ts` — read the anomaly boolean flags, which the view already gates on `r.attending` for `is_late_am`; the other three flags only fire from real boarding/check-in events that a non-attending kid won't have.

**Default-attending convention:** a missing day-record defaults to `attending: true` (dashboard + main roster `?? true`). A view row exists only when a `student_day_records` row exists, so this rarely bites; it means "no record" counts as attending — applied consistently across the count screens now.

See [[live-function-versions]].
