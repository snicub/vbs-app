---
name: no-login-session-mode
description: getSessionUser falls back to acting as the oldest coordinator/admin when no one is signed in — bypasses driver/aide van authz.
metadata:
  type: project
---

`src/lib/auth/session.ts` `getSessionUser()` runs in **no-login mode** (as of 2026-06-16): when there is no auth session it returns the oldest `coordinator`/`admin` row instead of null.

**Why:** stated intent is "staff don't sign in" — every screen opens and writes attribute to a real users row record_event can verify.

**How to apply:** this has a heavy van-flow consequence — if a driver/aide is NOT signed in, every van action attributes to one coordinator and the assigned-van authz (`_authorize_event`, `broadcastVanLocation`'s assignment check) is effectively bypassed (coordinator passes all checks; broadcast logs a `van_gps_override` incident every time). Audit trail collapses to one identity. Confirm with the user whether this ships to VBS week or is a dev-only convenience BEFORE relying on driver/aide authorization being enforced. Related: the offline outbox attributes queued actions to whoever `getSessionUser` resolves at SYNC time, which under no-login is always that coordinator. See [[van-authz-and-derivation]].
