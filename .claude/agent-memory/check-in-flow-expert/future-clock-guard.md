---
name: future-clock-guard
description: The future-clock guard (clampOccurredAt) that drops ahead-of-now occurredAt in both write paths — why it exists; now extracted + tested.
metadata:
  type: project
---

Both client-facing write paths drop any client `occurredAt` that is ahead of the server clock (kept if `<= Date.now()`), then let `record_event`/`smart_checkout` default a dropped value to `now()`. As of 2026-06-18 this is EXTRACTED + TESTED (the earlier "inlined/duplicated/untested" recommendation is satisfied):
- Shared helper: `clampOccurredAt(iso, nowMs)` in `src/lib/events/occurred-at.ts` — returns the ISO string if `<= now`, else `undefined`; `undefined`/null in → `undefined`; non-finite (malformed) → `undefined`.
- `submitEvent` (`src/server-actions/events.ts`) imports it → passes `undefined` through.
- `smartCheckOut` (`src/server-actions/check-out.ts`) imports it, coalesces `?? null` (smart_checkout defaults a null to now()).
- Tests: `tests/unit/occurred-at.test.ts` (11 tests, passing) cover future→dropped, past→kept, `== now`→kept (boundary `<=`), undefined→undefined, NaN/malformed→dropped.

**Why:** `occurredAt` exists for OFFLINE replay — an action taken in a dead zone should record when it happened, not when it later syncs. Real offline lag is always in the PAST. A future timestamp can only come from a fast tablet clock, and future-dating an event silences the overdue-van anomaly alarms (`is_pm_van_stuck`, `is_boarded_but_not_arrived`) and can poison the `smart_checkout` idempotency anchor. So future = untrusted = drop.

**How to apply:** Treat this as a solved problem; don't re-flag it as a gap. If you touch either write path, keep routing the client timestamp through `clampOccurredAt`. Related: [[event-authz-matrix]] (the `canUndo` 60s window in `undo-event.test.ts` is a separate time rule).
