---
name: test-coverage-gaps
description: What in the auth/session/role surface is tested vs. not, and the recommended test approach for the untested no-login gate
metadata:
  type: project
---

As of 2026-06-17 (branch feat/vbs-safety-offline-routing-efficiency), the only auth-domain test is `tests/unit/roles.test.ts` — full predicate matrix for isStaff/isCoordinator/canCheckIn/canDriveVan across all six roles. Solid.

UNTESTED (and these are the safety-relevant half): `getSessionUser` session resolution, the `ALLOW_NO_LOGIN` no-login gate decision, and `link-guardian.ts`. A regression that flips the OFF-default would silently grant coordinator power to any unauthenticated visitor on a public deploy, with green tests.

**Why:** The no-login gate is "device access = coordinator." The OFF-default (`if (!env.ALLOW_NO_LOGIN) return null` ordered BEFORE the kiosk lookup in session.ts) is the load-bearing safety line and has no regression guard.

**How to apply:** When asked to add tests here, recommend extracting the pure decision `resolveNoSession(allowNoLogin: boolean, oldestStaff: ProfileRow | null): SessionUser | null` out of `getSessionUser`, then unit-testing the branch table (P0): off+null→null, off+staff→null (flag wins), on+staff→that coordinator, on+null→null (lock-out edge). Reason for extraction: `env.ts` reads process.env at module-load (`export const env = parseEnv()`), so you CANNOT flip ALLOW_NO_LOGIN per-test by mutating process.env after import — a pure fn taking a boolean sidesteps the env-load-timing problem. P1: signed-in mapping (DB role wins, never client/auth identity; absent profile → parent). P2: link-guardian newest-only link + no staff-role downgrade. Do NOT test middleware (pure cookie refresh) or the deleted auth callback. See [[surface-drift]].
