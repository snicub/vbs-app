---
name: closeout-announcements-removed
description: /coordinator/closeout AND /coordinator/announcements were deleted as "not needed for this event" — my agent spec + CLAUDE.md still list them but they no longer exist.
metadata:
  type: project
---

`/coordinator/closeout` (route, `closeout-form.tsx`, `closeout.ts` server action, dashboard "closed at" badge) was removed 2026-06-27 (commit 6412b54, "Not needed for this event"). `/coordinator/announcements` is also gone (no route, no nav link). The `daily_closeouts` table still exists in migrations but nothing reads/writes it.

**Why:** Deliberate decluttering for the one-time event. Do NOT treat these as bugs or try to "restore" them — my own agent definition and CLAUDE.md still describe closeout/announcements as live; those references are STALE.

**How to apply:** End-of-day "is everyone accounted for?" now rests entirely on the `/coordinator` dashboard (state-count cards + roster), not a closeout snapshot. There is no positive "all home" confirmation and no end-of-day anomaly sweep. See [[dead-scheduled-time-anomalies]] for why the "never checked out" / "late AM" safety nets don't fire.
