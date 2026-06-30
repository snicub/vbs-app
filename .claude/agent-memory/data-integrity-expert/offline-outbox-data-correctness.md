---
name: offline-outbox-data-correctness
description: Data-correctness state of the van offline outbox (v1) — idempotent replay works AND occurred_at is now threaded for both submitEvent and smart_checkout; plus the no-login session default.
metadata:
  type: project
---

Van offline outbox v1 landed 2026-06-16 (`src/lib/offline/outbox.ts` pure core, `use-outbox.ts` glue, `offline-banner.tsx`, wired in `src/app/van/[vanId]/van-manifest.tsx`). Reviewed for DB/event-log correctness.

**Idempotent replay — SOUND.**
- `submitEvent` (`src/server-actions/events.ts:34,68`) takes an optional `idempotencyKey`; `van-manifest.tsx:218-221` generates `crypto.randomUUID()` ONCE per tap, uses it as BOTH the RPC idempotency key AND the outbox `dedupKey`, and the same payload object is reused on enqueue — so the key is STABLE across retries. `record_event` dedupes on `idempotency_key` (unique index backstop). One queued board → exactly one event. Good.
- `smartCheckOut` has NO client key param, but **0021** made `smart_checkout` idempotent: deterministic anchor key `smart_checkout:<student>:<date>:<last-event-id-or-'start'>:<event>` + per-step `begin…exception when unique_violation then null end` inside the per-(student,date) advisory lock. An offline checkout replayed sees the same anchor → unique-violation → clean no-op. No duplicate PM chain, no double parent_pickup. The outbox `enqueue` dedupKey is a second guard (a re-enqueue with same dedupKey is a no-op). Good.

**occurred_at — NOW THREADED (fixed, verified 2026-06-17).** The van UI captures `occurredAt = new Date().toISOString()` at tap time and puts it in the payload that the outbox stores and replays verbatim (`van-manifest.tsx` `fire()` line 232-233 for submitEvent, `fireCheckOut()` line 202-203 for smartCheckOut). `submitEvent` (`events.ts`) passes it to `recordEvent` → `record_event` (0017: `coalesce(p_occurred_at, now())`); `smartCheckOut` (`check-out.ts`) passes it to `smart_checkout` via **0022**'s new `p_occurred_at timestamptz default null` param (`v_base := coalesce(p_occurred_at, now())`, then `v_base + v_count*1ms` per step preserves chain ordering). So an offline AM board / PM drop-off replayed at sync time stamps the REAL action time → `is_boarded_but_not_arrived` / `is_pm_van_stuck` stay honest. **Future-clock guard (uncommitted, 2026-06-17):** both `events.ts:72-75` and `check-out.ts:110-113` drop any `occurredAt > Date.now()` (→ undefined/null → DB now()). Protects the overdue-van alarms AND the smart_checkout anchor key from a fast tablet clock; a legit PAST (offline) time always passes the `<=` guard so it is NOT corrupted. Cannot break ordering: anchor keys off latest-event ID (not occurred_at value), and a backward occurred_at only affects the +Nms chain offset which is internally consistent.

**No-login session default — by design, NOT a new hole.** `src/lib/auth/session.ts` returns the oldest admin/coordinator row when nobody is signed in. The DB still re-verifies `p_actor_role` against `public.users` in BOTH `record_event` and `smart_checkout` (the role is looked up server-side, client-supplied role ignored). RLS is already bypassed for staff event writes (admin client in events/check-out actions); release safety rests on `_authorize_event` + `getSessionUser`, not RLS. Blast radius = physical access to a staff device acts as coordinator — an accepted tradeoff for the volunteer/no-paper context. Not a regression introduced by the outbox.

**Regressions checked clean:** 0020 (view TZ pin) and 0021 (smart_checkout anchor over ALL rows) are the live defs — no later migration redefines the view or record_event (record_event still 0017). `boardedStopConflict` (`src/lib/routing.ts`) unchanged. The `attending`/morning-van filter `('van','parent_pickup_only')` in the view unchanged.

See [[live-function-versions]], [[smart-checkout-divergences]], [[append-only-and-locking]], [[anomaly-timezone-bug]].
