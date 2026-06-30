---
name: event-authz-matrix
description: Which role can write which event kinds, where it's enforced, and the undo/override authorization rules + time window.
metadata:
  type: reference
---

Authoritative source: `_authorize_event` in `0017_undo_authz_and_pickup_validation.sql` (latest `create or replace`). Called by `record_event`; `smart_checkout` calls it for the chain's gating event.

- **coordinator/admin** — everything (returns true immediately).
- **parent** — nothing (false).
- **table_volunteer** — `parent_dropoff, site_checked_in, site_checked_out, parent_pickup, no_show` (5 kinds) + `override` (for the Undo toast).
- **driver/aide** — only the 4 van events (`van_boarded_am/_offloaded_am/_boarded_pm/_offloaded_pm`) AND only for the kid's assigned AM/PM van (`_van_assigned_to_user_today`) + `override`.

**Undo path** (`undoEvent`, `src/server-actions/events.ts`): writes a superseding `override` event (uses admin client, `asAdmin`). Allowed if actor is owner OR coordinator/admin; non-coordinators blocked from reversing `no_show` (one-way door); non-coordinators have a **60-second** age window AND can't undo if newer non-superseded events exist. `_derive_state` filters out `override` + superseded rows, so an undo reverts state.

**Override panel** (coordinator-only, `student-actions.tsx`): records the chosen REAL event type (e.g. `parent_pickup`) with an `override_reason`. If the transition is illegal, `record_event`'s override branch (coordinator/admin + non-empty reason) permits it. `_derive_state` reads the real event type, so override `parent_pickup` from `marked_no_show` legitimately moves the kid to `home` — intended (coordinator fixes anything).

**Note:** `record_event` does NOT run the restricted-pickup check or require pickup-name — those live only in `smart_checkout`. See [[restricted-release-status]].
