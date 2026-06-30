---
name: live-function-versions
description: Which migration holds the LIVE definition of each DB function/view (functions redefined via create-or-replace; latest wins). Verified 2026-06-16 (incl. 0020/0021).
metadata:
  type: project
---

Live definitions of the data-layer functions/view, as of 2026-06-16 (verified by grepping every `create or replace` across `supabase/migrations/`, including 0020/0021). Functions are redefined wholesale; the LATEST migration wins.

- **`record_event`** — live in **0017** (adds the inside-lock supersession check on `p_supersedes_event_id`). 0012 was the prior version (role-verification fix). NOT 0004.
- **`_authorize_event`** — live in **0017** (adds the staff-`override` branch for the Undo toast). Table volunteers can write 5 kinds + override; driver/aide = 4 van events + assigned-van match; parent = none.
- **`smart_checkout`** — live in **0022** (2026-06-16), NOT 0021/0019. 0022 adds an optional `p_occurred_at timestamptz` arg (7-arg signature; drops the old 6-arg one) so offline-replayed checkouts stamp the real drop-off time, not sync time; per-event `+Nms` ordering preserved off `v_base = coalesce(p_occurred_at, now())`. 0021 made it idempotent: deterministic anchor-keyed idempotency_key (`smart_checkout:<student>:<date>:<last-event-id-or-'start'>:<event>`) wrapped in a `begin … exception when unique_violation then null end` per-step subtransaction. 0019 added the parent_pickup name requirement + restricted "do-not-release" block + `parent_pickup_has_name` CHECK (`not valid`). 0018 was authz-by-kind; 0012 role-verification.
- **`student_day_status` view** — live in **0026** (2026-06-28), NOT 0023/0020/0012. 0026 adds soft-archive: `join public.students s on s.id = r.student_id and s.archived_at is null` (verified diff vs 0023 = ONLY that one added line) so archived kids emit NO rows from the view → hidden from every screen that drives off the view. See [[student-soft-archive]]. 0023 added a **30-minute grace period to `is_in_but_not_out`** (`+ interval '30 minutes'` after the PM-start `at time zone 'America/Chicago'` deadline) so the "Never checked out" critical no longer fires for every kid at the exact PM bell — mirrors is_late_am's +45m. 0020 pinned the two clock-based flags (is_late_am, is_in_but_not_out) to `at time zone 'America/Chicago'` (vs session-mutable GUC). The `is_late_am` mode filter stays `('van','parent_pickup_only')` (correct; do NOT align to smart_checkout's `parent_dropoff_only`). pgTAP for the grace period + archive filter is UNVERIFIED (needs Docker).
- **`_is_legal_transition` / state machine** — live in **0009** (AM van → site_checked_in directly). TS mirror `src/lib/events/state-machine.ts` matches exactly.
- **`_reject_event_mutation` + `_mark_superseded`** — 0003 (append-only trigger + the one SECURITY DEFINER escape hatch via `session_replication_role = replica`).

CLAUDE.md and the old data-integrity charter are STALE on smart_checkout (still say 0018) and on the parent_pickup CHECK + restricted-block being unbuilt — both shipped in 0019. Always re-grep before trusting version claims. See [[smart-checkout-divergences]] and [[attending-filter-map]].
