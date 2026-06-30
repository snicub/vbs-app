---
name: arrived-at-site-count-gap
description: Known, accepted-for-go-live gap — arrived_at_site state counts in no dashboard stat card
metadata:
  type: project
---

`arrived_at_site` is a real reachable state (`van_offloaded_am → arrived_at_site → site_checked_in`) but `computeMetrics` in `src/lib/coordinator/dashboard.ts` counts it in NO card: `ON_BOARD`, `AT_SITE_NOW` (= `site_checked_in` only), and `REACHED_CHECK_IN` all exclude it. So a kid offloaded from the AM van but not yet table-checked-in is in `expected` + the roster but in zero stat card — the cards don't sum to `expected` for that window.

**Why accepted at 2026-06-18 go-live:** the offload→table-scan window is seconds, and `van_offloaded_am` isn't even recorded in the common van flow, so the gap is usually empty. Pre-existing, not a regression, user's call to ship.

**How to apply:** If asked to make the cards reconcile to `expected`, the fix is to add `arrived_at_site` to `AT_SITE_NOW`/`atSite` (or a catch-all). Don't "fix" it silently — it was a deliberate ship decision. See [[capacity-cron-rename]] for the other go-live-pass item.
