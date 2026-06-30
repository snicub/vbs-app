---
name: smart-checkout-divergences
description: How smart_checkout (live 0019) diverges from record_event, and the remaining idempotency/durability gap.
metadata:
  type: project
---

`smart_checkout` (live in **0019**) records the whole PM checkout chain with **direct inserts inside its own advisory lock, bypassing `record_event`**. Verified 2026-06-16.

**Still divergent / risky:**
- **NOT idempotent.** Every chain step mints a fresh key `'smart_checkout:' || gen_random_uuid()` (0019 line 154). A double network submission, retry, or two stations tapping "Dropped off" both succeed and **double-insert the PM chain** (e.g. two `parent_pickup` rows). The client (`van-manifest.tsx` `fireCheckOut`) disables the button via `isPending` but that is per-component, not durable. `record_event` would dedupe on `idempotency_key`; smart_checkout has no such guard. Recommended fix: deterministic key per (student, date, step), e.g. `smart_checkout:<student>:<date>:<event_type>` — collides on retry so the unique index rejects the dupe; or pass a client-supplied request id and derive per-step keys from it.
- **Skips per-step legality.** It hard-codes the chain by current state, never calls `_is_legal_transition` between steps. Safe today because the chain is pre-shaped by `v_state`, but any new business rule added to `record_event` will NOT apply here.
- **`now() + n ms` ordering is load-bearing.** The view's "last event wins" derivation depends on each chain step being 1ms apart. Fine, but fragile — don't remove.

**Already fixed in 0019 (was a gap, now closed):** parent_pickup requires a non-blank name; restricted pickup person blocked (id or name match); `parent_pickup_has_name` CHECK constraint exists (`not valid`, new rows only).

See [[live-function-versions]] and [[append-only-and-locking]].
