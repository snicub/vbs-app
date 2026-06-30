---
name: unit-reimplementation
description: Status of the four extraction tests — now import real modules, not re-implementations (resolved 2026-06-17)
metadata:
  type: project
---

RESOLVED as of 2026-06-17. The three tests that used to copy production logic now import and exercise the real modules. The drift hazard is gone for these.

- **`tests/unit/undo-event.test.ts`** — now imports the real `canUndo` from `@/lib/events/undo` (11 call sites, no local redefinition). The inline ladder was extracted into that pure helper.
- **`tests/unit/anomaly-watch.test.ts`** — now imports the real aggregation from `@/lib/notifications/anomaly-watch` (the cron's pair-explosion + dedup-by-`studentId:kind` was extracted into a tested lib; commit 20bf5a6 "extract anomaly-watch aggregation to tested lib"). Only local code is a fixture row-builder.
- **`tests/unit/student-actions-surface.test.ts`** — imports the real `isLegalTransition`/`STATES` from `@/lib/events/state-machine`; no local re-implementation of the primitive.
- **`tests/unit/routing.test.ts`** — imports the real `boardedStopConflict` from `@/lib/routing` (used by `updateStudentDayRecord`).

**Why this matters:** these were the "pass while prod rejects" hazards. Importing the real module means a drift in the action/cron now breaks the test. Verify periodically that no NEW test re-introduces a local copy.

**Open untested gap (working tree, 2026-06-17 — NOT a re-implementation issue, a coverage gap):** two new server-action guards have NO unit test because the logic is inline in the action, not a pure helper:
- `submitEvent` future-clock drop (`src/server-actions/events.ts` ~line 67-74): drops `occurredAt` when ahead of `Date.now()`. Clean add: extract a pure `clampOccurredAt(ts, now)` and unit-test "future → undefined, past → kept".
- `updateStudentDayRecord` mode-change stop-clearing + mode-vs-boarded-state guard (`src/server-actions/students.ts` ~line 130-200): the `ridesAm`/`ridesPm` derivation and the "boarded child switched off the van" block are inline. The adjacent stop-change path delegates to the tested `boardedStopConflict`; the mode path does not. Worth extracting a pure helper.

Related: [[suite-environment]], [[pgtap-stale-authz]].
