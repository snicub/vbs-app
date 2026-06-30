---
name: van-flow-known-bugs
description: Open bugs/risks in the driver/aide van flow — GO-LIVE re-verified 2026-06-18 on main. All prior blockers CLOSED. Cron rename has zero van ripple.
metadata:
  type: project
---

**2026-06-18 DOOR-TO-DOOR review (review-only, `main`) — OPEN UX GAP.** The van surface has NOT been adapted to door-to-door yet. `/van/[vanId]/page.tsx` still does NOT fetch `families` / `street_address` / `lat,lng` — the rider list shows name/photo/color/wristband but NO home address, so the driver can't see where to drive. No no-address flag either. `van-manifest.tsx` still groups rows by `stopName` (`groupByStop` :36-49, render :327-338) + sorts by route stop-order — both collapse to a single mislabeled "Stop:" section under the one-zone model; the PhotoVerifyModal shows "Stop: {zone placeholder}" (:556-561), which is wrong under door-to-door. **Fix (one pass, NOT done): mirror `/coordinator/print/page.tsx:96-104` (students.family_id → families address join), thread `homeAddress`+no-address flag onto RosterItem, render address big, replace groupByStop with a flat name-sorted list, fix the modal "Stop:"→home address.** Correctness/authz/GPS all still GO; only the address UX is the go-live gap.

**2026-06-18 GO-LIVE re-verify (on `main`, review-only).** The feat/vbs-safety-offline-routing-efficiency branch is MERGED to main. Van surface is GO. The in-flight cron rename (uncommitted: `day-before-reminder` deleted, `anomaly-watch` modified, new `capacity-check`; vercel.json now runs capacity-check @ `0 0 * * *` + anomaly-watch @ `*/5 11-23`) has **ZERO ripple into the van surface** — grep of src/app/van, server-actions/van|check-out|events, lib/offline, lib/wake-lock shows no cron/route reference. Van actions are decoupled from crons. typecheck clean; outbox + occurred-at tests green (29).

NOTE: `clampOccurredAt` is now a shared module `src/lib/events/occurred-at.ts` (imported by both events.ts and check-out.ts), not inline as older memory said — refactor, not regression. The future-clock guard (drop client `occurredAt > now()`) is intact in both paths.

Re-verified 2026-06-17 against branch `feat/vbs-safety-offline-routing-efficiency` (review-only). The van surface is in good shape — no blockers found. `smart_checkout` is now live as `0022_smart_checkout_occurred_at.sql` (7-arg, supersedes 0021's 6-arg, which is dropped).

**CORRECTION to an earlier finding — the 0021/0022 Undo-then-redo anchor is CORRECT, NOT a bug.** My prior memory claimed the anchor SELECT "excludes override + superseded rows" → would silently dedupe a redo. That was a MISREAD. The anchor query (`0022:70-74`, identical in 0021) is `select id ... order by occurred_at desc, id desc limit 1` with NO filter — it includes override + superseded rows by design (comment at 0022:67-69 says so explicitly). An Undo records an `override` row at `now()` (record_event 0017:129 `coalesce(p_occurred_at, now())`, undo passes no occurredAt) which becomes the newest row → anchor MOVES to the override id → a legitimate re-checkout computes a fresh key and records. Confirmed correct. Removed the false blocker.

**CLOSED — common-case idempotency correct (0021→0022).** Double-tap / concurrent retry from any start state is a clean no-op via the deterministic anchored key + `unique_violation` guard, backed by the global unique index on `idempotency_key` (migration 0003). 0022 adds `p_occurred_at` threading (offline replay stamps real drop-off time, +Nms ordering preserved). The 0018 PM-chain authz (gate van chain on `van_offloaded_pm`, parent chain on `parent_pickup`) survives 0022 byte-for-byte. See [[van-authz-and-derivation]].

**CLOSED — attending filter.** `/van/[vanId]/page.tsx:63` now has `.eq("attending", true)`. Non-attending kids no longer appear on the rider list.

**CLOSED — "manifest" rename (user-facing).** `/van/[vanId]/page.tsx:147` heading is now `{van.name} — riders`; count line reads "N kids". No user-facing "manifest" left in the van surface. Internal `van-manifest.tsx` / `VanManifest` retained per direction.

**RESOLVED-CONDITIONALLY — NULL-stop van kids.** The address→route builder now exists (`src/server-actions/routing.ts` writes `morning_stop_id`/`afternoon_stop_id` back to `student_day_records`, lines ~139-140), so once a coordinator runs it the view derives a van and the kid appears on the rider list + becomes droppable. The van screen itself is correct and unchanged; the residual risk (a van kid invisible UNTIL routing is run) is owned by the location/routing flow, not the van surface.

**GPS reliability quirks (van-manifest.tsx) — unchanged, still correct.** 15s client throttle (line 100) + wake-lock both present. Backgrounding pauses the watch; only a foreground `visibilitychange` re-arms it (line 126). No staleness alert here (live-map owner). Wake-lock no-ops on in-app browsers (toast warns). GPS correctly non-blocking — boarding/checkout never await it.

Related: [[van-authz-and-derivation]]
