---
name: gps-broadcast-vs-offline-outbox
description: Why van GPS broadcast is deliberately NOT routed through the offline outbox, and the silent-failure nit in the broadcast callback
metadata:
  type: project
---

The van screen (`src/app/van/[vanId]/van-manifest.tsx`) has both a store-and-forward **offline outbox** (`src/lib/offline/{outbox,use-outbox}.ts`, v1 landed 2026-06-16) for event/checkout writes AND the live **GPS broadcast** (`broadcastVanLocation`). They are intentionally separate.

**GPS is NOT queued in the outbox — and that's correct.** Only `submitEvent` + `smartCheckOut` are registered as outbox senders (`useOutbox({ submitEvent, smartCheckOut })`). `broadcastVanLocation` is called fire-and-forget in the `watchPosition` success callback.

**Why:** A queued GPS fix replayed minutes later would place a van where it no longer is — a stale-but-confident position is *worse* than a gap, which the map's `gps-freshness` indicator already flags as stale/dark. Best-effort, drop-on-failure is the safety-correct choice for live location. Events/checkouts are different — they must never be lost, so they queue.

**How to apply:** Do not "improve" GPS by adding it to the outbox. If a van is offline, the right outcome is the map showing it stale/dark, not a delayed teleport. See [[map-realtime-mechanics]] freshness section.

**Open nit (low sev, van-flow-owned UI):** the `watchPosition` success callback is `async` with no try/catch. A returned `{ok:false}` (e.g. "Not assigned to this van today") toasts + sets `error` but does NOT stop broadcasting; a true network failure (offline) makes `broadcastVanLocation` throw → unhandled rejection, no toast, and the GPS box keeps showing "ON" while silently failing every 15s. The map's staleness indicator is the real backstop. If touched: wrap the broadcast in try/catch and surface "can't reach server — location not updating."
