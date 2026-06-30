---
name: pickup-safety-0019
description: Restricted-release block + parent_pickup name CHECK now EXIST (migration 0019, 2026-06-16) — CLAUDE.md "blocker" claims are stale; both untested
metadata:
  type: project
---

CLAUDE.md (and the older audit notes) repeatedly call out two "BLOCKERS": (1) restricted "do not release to" has zero server enforcement, (2) the parent_pickup "who picked up" CHECK was never created. **Both are now FIXED in `supabase/migrations/0019_pickup_safety.sql` (modified 2026-06-16).** Verify before repeating the stale claim.

What 0019 actually added:
- `smart_checkout` now refuses a parent_pickup when the pickup person is `is_restricted` — matched by `authorized_pickup_person_id` OR by case-insensitive name (so a free-form typed name can't bypass) → raises 42501. Also requires a non-empty `metadata->>'name'`.
- A second enforcement layer: the `smartCheckOut` server action (`src/server-actions/check-out.ts`, lines 53-83) does the same restricted-person check BEFORE the RPC, using the admin client.
- A DB CHECK constraint `parent_pickup_has_name` on `student_day_events` (NOT VALID, governs new rows): a parent_pickup row must have `override_reason` OR a non-empty `metadata->>'name'`.

**Coverage gap:** NONE of this is tested. No unit test (it's DB/RPC logic — shouldn't be mocked), no integration test (tests/integration is empty), no pgTAP assertion. This is the single most safety-critical release path and it has zero automated proof. It also BREAKS pgTAP #19 (see [[pgtap-stale-authz]]) because that old assertion logs a coordinator parent_pickup with empty metadata.

Where to put real coverage: pgTAP assertions against the live `smart_checkout` (restricted-by-id blocked, restricted-by-name blocked, empty-name blocked, happy path allowed) + an integration test of the `smartCheckOut` server action against local Supabase.

Related: [[pgtap-stale-authz]], [[suite-environment]].
