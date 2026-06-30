---
name: suite-environment
description: What the test suite looks like in this environment — Docker/pgTAP availability, real test counts, which scripts run what
metadata:
  type: project
---

State of the test suite as of 2026-06-18 (branch `main` @ 4ee625c + an UNCOMMITTED working tree carrying the door-to-door / per-van-zone rework).

**2026-06-18 door-to-door rework (uncommitted, verified GREEN — typecheck + lint + `pnpm test` = 39 files / 419 tests):** the model pivoted from shared corner stops to "each van IS one pickup zone" (a `stops` row carrying the van's color + AM/PM times, sitting on both its routes; town = van name). Stop legs (`morning_stop_id`/`afternoon_stop_id`) are STILL the storage; the view derives the van from them — so `morningStopId`/`town`/`stop_id` refs in tests are NOT stale, they're the live model. NEW pure helpers, ALL well-tested: `assignLegsForVan` (`lib/van-assign.ts` → `van-assign.test.ts`, 8 cases: mode matrix + minimal non-destructive patch); `zoneStopIdForVan`/`findVansMissingZone`/`isValidTimeOfDay` (`lib/vans.ts` → `vans.test.ts`); `route-build.ts` `assignStopsForMode` rewritten zone-as-van (one van, both legs same zone, anchor-not-split) → `route-build.test.ts` 11 cases; `computeVanBreakdown` replaced `computeTownBreakdown` (clean removal, no dangling refs) → `dashboard.test.ts` 5 cases. Deleted `route-editor.tsx` (no dead test refs). pgTAP unchanged (`plan(30)`, last 9c174e2) — NOT updated for the zone model, still Docker-unverified.

**UNTESTED new glue (server-action orchestration, not pure → no unit test):** `assignStudentToVan` (`students.ts` ~220: zone-resolution, the `zoneStopIds.length>1` "more than one zone" reject, boarded-leg guard) only the inner `assignLegsForVan` is tested; `createVan`/`ensureVanZones`/`provisionVanZone` (van+zone provisioning + rollback) in `vans.ts`; `updateVan` area-geocode-on-save (reject when address won't geocode); `autoAssignStopsFromAddresses` (`routing.ts`) candidate-filtering (routed+coords stops only) + batched geocode. These are DB/geocode-dependent → belong in `tests/integration` (still empty), not mocked.

---
(historical, pre-rework:)

**Docker is DOWN in this environment** and the `supabase` CLI is not on PATH for a bare shell (`command not found: supabase` — it's a devDependency, reachable via `pnpm supabase` / `pnpm exec`, not globally). So `pnpm test:db` (pgTAP) and `pnpm test:integration` (needs local Supabase) CANNOT run here. Any claim that pgTAP passes is unverified until Docker is up.

**Real counts (verified by running typecheck+lint+`pnpm test` 2026-06-18, clean tree):** **38 unit test files, 393 tests, all pass** in ~5s; `pnpm typecheck` and `pnpm lint` both clean. CLAUDE.md's "193/194" is stale — don't trust the number, run it. The `isOutboxEntry` load-time guard cases live in `outbox.test.ts` and import the real `@/lib/offline/outbox`.

**2026-06-18 cron rework (verified GREEN):** the day-before reminder cron + `dayBeforeReminder` template + its template test were REMOVED; a new `/api/cron/capacity-check` route replaces it (alongside `/api/cron/anomaly-watch`). Verified ZERO remaining references to `dayBeforeReminder`/`day_before_reminder`/`day-before-reminder` across tests/src/supabase. `capacity.test.ts` is valid (comment updated to "capacity-check cron") but RE-IMPLEMENTS the AM/PM rider-count + overcapacity aggregation inline (lines 16-41) — it mirrors the cron math rather than importing it (extraction candidate, not a regression). `templates.test.ts` `confirmationOnRegister` now asserts the body contains "STOP" (opt-out line).

**2026-06-18 signup-rework regression audit (commits bbf1cee + 4a2b64c on main):** GREEN. The signup rework (drop State/ZIP inputs, age cap 18→99, allergies merged into medical_notes, trimmed success screen, stable child-draft ids) shipped WITHOUT leaving stale tests. Verified no test still asserts State/ZIP-required: `registration-schema.test.ts:89` ("requires a home address when a child needs a van") asserts only `family.streetAddress`, never state/postalCode. Its happy-path fixture still carries `state`/`postalCode` but they're now harmless optional fields the schema still accepts. No success-screen unit test exists (it's JSX in signup-form.tsx), so the trim broke nothing. `failsafe-print-data` + `state-presentation` allergy refs are the print/presentation layer (DB `allergies` column still exists) — NOT invalidated.

**What each script actually runs (from package.json):**
- `pnpm test` = `vitest run` → unit only (vitest.config.mts, `tests/unit/**`).
- `pnpm check` = `typecheck && lint && test` → **does NOT run pgTAP and does NOT run integration.** The DB heart of the app is never verified on a normal commit. Confirmed.
- `pnpm test:integration` = `vitest run --config vitest.integration.config.mts` → `tests/integration/**/*.test.ts`, node env, needs `.env.test`/`.env.local` with Supabase URL+anon+service_role.
- `pnpm test:db` = `supabase test db` → pgTAP in `supabase/tests/*.sql`. Needs Docker + `pnpm supabase:reset`.
- `pnpm test:e2e` = `playwright test`.

**tests/integration/ is EMPTY** (confirmed — `ls` shows no files). The config + setup-integration.ts exist and are wired; there's just nothing to run. No `.env.test` exists.

**E2E** = only `tests/e2e/smoke.spec.ts` (3 trivial render checks: home, login, signup). No flow coverage.

**Only ONE pgTAP file:** `supabase/tests/record_event.sql` (now `plan(30)` — verified 30 assertions present: 10 is(), 6 lives_ok(), 14 throws_ok(); plan matches body). Still Docker-gated → unverified-running here. See [[pgtap-stale-authz]].

**Overnight extractions (verified @ 5329cd3 — all import REAL logic, no re-implementation):** `student-filter.test.ts`→`@/lib/coordinator/student-filter`; `undo-event.test.ts`→`canUndo` from `@/lib/events/undo`; `pickup-options.test.ts`→`buildPickupOptions` from `@/lib/checkin/pickup-options`; `anomaly-watch.test.ts`→`@/lib/notifications/anomaly-watch`. The ONLY remaining inline re-derivation is `student-actions-surface.test.ts` (intentional: imports the real `isLegalTransition`/`STATES` from `@/lib/events/state-machine` and composes the button-set inline at lines 12-16 — it pins the contract, not a logic copy). See [[unit-reimplementation]].

Related: [[pickup-safety-0019]], [[unit-reimplementation]].
