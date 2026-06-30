---
name: restricted-release-status
description: Current state of restricted "do-not-release" enforcement and the parent_pickup pickup-name requirement, after migration 0019.
metadata:
  type: project
---

Migration `0019_pickup_safety.sql` CLOSED the two custody blockers that older CLAUDE.md notes still list as open. The `smart_checkout` body has since been redefined twice more (latest wins): `0021` (deterministic idempotency key + `unique_violation` no-op → a double-tap can't double-insert the chain) and `0022` (adds `p_occurred_at` for offline replay, drops the old 6-arg signature). **The live signature is 7-arg `smart_checkout(uuid, date, uuid, user_role, text, jsonb, timestamptz)`.** All pickup-safety checks are byte-identical across 0019/0021/0022. Verified against current code 2026-06-17:

- **Restricted release IS server-enforced** in two layers: the `smartCheckOut` server action (`src/server-actions/check-out.ts:59-86`) pre-checks `authorized_pickup_persons.is_restricted` by id AND lowercased name, and `smart_checkout()` (`0022:125-139`) backstops it inside the lock for direct RPC calls. Residual gap (low sev): name-match is **exact lowercased string** — an unlisted typed "Bob Smith" vs restricted "Robert Smith" slips the name-match (id-match is airtight). Banner + unlisted-pickup incident are the human backstop.
- **parent_pickup pickup-name IS required**: `smart_checkout` raises if `metadata->>'name'` is empty (`0022:120-123`), and a `parent_pickup_has_name` CHECK constraint (`0019:177-185`, `NOT VALID`) enforces it at the table — EXCEPT rows with a non-null `override_reason`, which are exempt.

**Why:** CLAUDE.md "Current status" still says these are BLOCKERs — it predates 0019. Trust the migration.

**How to apply:** Don't re-report these as unfixed. As of a 2026-06-16 working-tree review (uncommitted), the last hole is ALSO closed: `parent_pickup` was REMOVED from `OVERRIDABLE` in `student-actions.tsx` (now ends at line ~561, comment explains the rationale). The override panel no longer offers `parent_pickup`, so the only release path is the picker → `smartCheckOut`, which enforces both the restricted block and the name. Coordinators release from odd/terminal states by walking the kid to `site_checked_out` via override (still in OVERRIDABLE), then using the picker. Verified: no legitimate release path lost; `smart_checkout` raises "Cannot check out from state" for not_started/van_boarded_am/arrived_at_site, which is fine because those are reachable forward then released. See [[event-authz-matrix]]. Restricted-release is now fully server-enforced on every reachable path.
