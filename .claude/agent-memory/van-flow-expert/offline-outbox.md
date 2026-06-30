---
name: offline-outbox
description: How the van offline outbox (v1) works, its correctness model, and the open occurred_at blocker.
metadata:
  type: project
---

Van offline outbox v1 landed 2026-06-16. Store-and-forward queue so the driver/aide can board/drop-off with no signal.

**Why:** dropped check-in = a kid unaccounted for; the van is the lowest-connectivity surface.

**How to apply:** when touching the van action path, preserve these invariants — they're the whole safety model.

## Shape
- `src/lib/offline/outbox.ts` — PURE core (no DOM/storage/net), exhaustively unit-tested (`tests/unit/outbox.test.ts`). Functions: `makeEntry`, `enqueue` (dedupKey-collision no-op), `syncable` (pending, sorted by `capturedAt` then id — FIFO), `processQueue` (drain in order; ok→remove, rejected→`failed`+keep, network→stop+keep pending), `pendingStudentIds`, `counts`.
- `src/lib/offline/use-outbox.ts` — browser hook: localStorage key `vbs.outbox.v1`, 20s sync interval + online/offline listeners, `router.refresh()` after sync.
- `src/components/offline-banner.tsx` — offline/syncing/failed banners; failed has a Retry button.
- Wiring in `van-manifest.tsx`: `fire()` (AM board) and `fireCheckOut()` (PM) check `navigator.onLine`, else enqueue; also `.catch()` re-enqueues a request that never landed.

## What's CORRECT (don't regress)
- **Frozen idempotency key:** minted ONCE per tap (`crypto.randomUUID()`), reused on every retry, never regenerated in `processQueue`. AM path passes it as `idempotencyKey` (events.ts now accepts optional `idempotencyKey`; `record_event` dedups on it).
- **smart_checkout replay-safe via 0021** (NOT a client key): deterministic key anchored to the latest event id at chain-build time; identical retry collides on unique index → no-op. Replay after kid is `home` derives an empty chain, `events_recorded:0`, returns `{ok:true}`. **This safety depends on 0021 being deployed** (latest migration, pgTAP-unverified) — if 0021 isn't live, an offline checkout retry double-inserts the PM chain.
- **Never silently drop:** permanent rejection (illegal transition by sync time) → `failed`, kept, loud red banner. Network error → stop draining, keep pending.
- **FIFO per state machine:** `syncable` sorts by `capturedAt` so board syncs before offload.

## occurred_at = action time — RESOLVED (verified 2026-06-17)
The old "occurred_at = sync time" blocker is FIXED. Both paths now capture at TAP time and thread it through: `fire()` and `fireCheckOut()` mint `occurredAt = new Date().toISOString()` at tap; AM passes it in the `submitEvent` payload, PM passes `occurredAt` → `smart_checkout`'s `p_occurred_at` (check-out.ts). `capturedAt` (the outbox sort key) is minted in the hook's `enqueue` at enqueue time, which is also tap-time, so FIFO order is preserved. If re-touching, keep occurredAt minted in `fire`/`fireCheckOut`, not in the outbox.

**Future-clock guard (server-side, added 2026-06-17):** both `submitEvent` (events.ts) and `smartCheckOut` (check-out.ts) now DROP any client `occurredAt > Date.now()` and fall back to server now() (undefined for record_event, null for smart_checkout). Reason: a van tablet running fast would future-date the event and silence the overdue-van anomalies (`is_boarded_but_not_arrived`, `is_pm_van_stuck`). Real offline lag is always PAST, so legit offline taps are preserved; only a fast-clock future stamp is dropped — strictly safer, and the occurred_at-preserved invariant still holds for the never-drop guarantee. NB: the inline comments also claim it "poisons the idempotency anchor" — that's inaccurate (the 0021/0022 anchor is the latest existing event id, independent of occurred_at); the anomaly-silencing reason is the real one. Don't remove this guard when touching either path.

## COLD-OPEN OFFLINE IS DEAD — service worker is a KILL SWITCH (verified 2026-06-16)
`public/sw.js` is a no-fetch-handler self-destruct worker; `ServiceWorkerRegister` (mounted in `app/layout.tsx`) actively unregisters any SW and clears `vbs-*` caches. Reason: the old offline shell served stale/unstyled HTML. CONSEQUENCE: the outbox only protects writes AFTER `/van/[vanId]` is already loaded. A driver who reloads or cold-opens with no signal gets nothing. The offline-banner copy ("your taps are saved here") oversells resilience. Any "make the van work offline" ask must address app-shell caching (navigation-only fallback) — and watch the regression that caused the kill switch. See [[van-flow-known-bugs]].

## NO realtime on the van screen
Unlike `/coordinator`, `/van/[vanId]` has no realtime subscription — roster only refreshes via `router.refresh()`. A stop/state change on another device isn't seen until then; a now-illegal queued action correctly `rejected`s rather than mis-applying. Safe but stale. `loadedAt` passed to the banner is render-time, not last-good-data-time, and never escalates with age.

## Outbox dead/wasteful spots (review 2026-06-16)
- `useOutbox` returns `failed` (array) + `syncNow` — neither consumed by van-manifest. `attempts` is incremented/persisted but never read (no retry cap, no UI).
- 20s sync `setInterval` runs the whole shift even with an empty queue (sync early-returns, cheap but a battery wakeup); `commit` re-writes localStorage even on no-op reconciles.
- No way to dismiss a `failed` entry — only Retry (which re-fails for a permanently-illegal stale action), so the red banner is sticky.
