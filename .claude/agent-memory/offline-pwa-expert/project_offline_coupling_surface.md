---
name: offline-coupling-surface
description: The only coupling between the offline outbox and the rest of the app — what a coordinator/registration/routing change can and cannot ripple into
metadata:
  type: project
---

The offline outbox couples to the rest of the app at exactly ONE seam: the two replay senders wired in `src/app/van/[vanId]/van-manifest.tsx` — `useOutbox({ submitEvent, smartCheckOut })`. Everything queued is one of `kind: "submitEvent"` or `kind: "smartCheckOut"`, with a JSON payload the van page builds at tap time:
- submitEvent payload: `{ studentId, eventDate, eventType, vanId, idempotencyKey, occurredAt }`, dedupKey = idempotencyKey
- smartCheckOut payload: `{ studentId, eventDate, occurredAt }`, dedupKey = a fresh clientId()

Both senders take `input: unknown` and re-parse with their own zod schema, so the replay contract is decoupled by design.

**Why:** lets me judge ripple from changes in other flows quickly. A change is offline-relevant ONLY if it alters: (1) the signature/parse-shape of `submitEvent` (`server-actions/events.ts`) or `smartCheckOut` (`server-actions/check-out.ts`); (2) the idempotency/dedup behavior at the DB (record_event idempotency_key, smart_checkout deterministic anchor key); or (3) what the van page enqueues.

**How to apply:** when reviewing ripple from a coordinator/registration/routing/setup change, check it against those 3 things. Transport-mode setup, van assignment from addresses (`lib/van-assign.ts`), nametag colors, dashboard counts, route building — none of these touch the van event-WRITE path, so they cannot ripple into the outbox. Confirmed unaffected at the 2026-06-18 door-to-door + per-van-area-location review. Related: [[outbox-safety-contract]].
