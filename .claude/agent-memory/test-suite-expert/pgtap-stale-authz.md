---
name: pgtap-stale-authz
description: The pgTAP record_event suite — un-staled 2026-06-16 for 0017/0019/0021 authz; static trace says all 22 should pass but never run under Docker
metadata:
  type: project
---

`supabase/tests/record_event.sql` (22 assertions) covers `record_event`/`_authorize_event` (0017), `smart_checkout` (0021), pickup CHECK (0019). It was **un-staled on 2026-06-16** — the old fixture gaps (no `student_day_records`, no `van_assignments`, missing pickup name) that made it green-theater are now FIXED. Still **never run under Docker** (Docker down in this env every session so far). Static trace = best available proof.

**Fixtures now (lines 22-81):** 4 users incl. a `table_volunteer`; 3 students all on stop `40000…001`; that stop is on Van 1's AM **and** PM routes; a `van_assignments` row puts the aide on Van 1 for `current_date`; all 3 students get `student_day_records` (mode 'van', that stop AM+PM). Result: every student derives `morning_van_id = afternoon_van_id = Van 1` via the view, and the aide is authorized for their van events. This is what makes the role×event×van matrix actually fire.

**Static trace verdict (2026-06-16): all 22 should PASS once Docker runs.** Key load-bearing checks:
- **#5, #11** expect **42501** (not P0001) — CORRECT now: `_authorize_event` runs BEFORE the lock/legality in `record_event` (0017 line 161), and an aide is never authorized for `site_checked_in` → 42501 before the state machine is consulted.
- **#2, #6, #21** (aide van events / `smart_checkout`) PASS because the view derives Van 1 for the students and the aide is assigned Van 1 (`_van_assigned_to_user_today` filters `assignment_date = current_date`, which the fixture uses).
- **#19** `parent_pickup` carries `'{"name":"Parent A"}'` in metadata slot 10 (params: van, stop, override_reason, metadata) → satisfies the 0019 `parent_pickup_has_name` CHECK. Student 2's state going in is `site_checked_in` (the #18 `no_show` was superseded, so `_derive_state` falls back to the #14 `parent_dropoff`), so the `site_checked_out`→`parent_pickup` chain is legal.
- **#20** expects **P0001** (illegal transition, not authz): the aide IS authorized for `van_boarded_pm` (assigned to student 2's afternoon van), so `home`→`van_boarded_pm` is rejected by the state machine — proving authz passed and legality failed. Correct.
- **#16** expects P0001 from the no-update trigger (`_reject_event_mutation`, errcode P0001). Correct.

**One thing only a live run can catch:** the `parent_pickup_has_name` CHECK was added **NOT VALID** (0019 line 185) — so it governs new inserts. #19's coordinator parent_pickup must satisfy it (it does, via metadata name). If a future edit drops that metadata, #19 fails with 23514, not P0001/authz.

**#23 (added since):** asserts `record_event` stores a client-supplied `occurred_at` (offline-replay contract, migration 0022). Static-trace passes.

**Still TODO regardless of green:** the suite tests only the HAPPY authz cases. It does NOT assert the negative matrix — aide with NO assignment → 42501; aide on the WRONG van → 42501; `table_volunteer` doing `van_boarded_pm` → 42501; `parent` → 42501. Nor does it assert the **restricted-release DB backstop** (0019 `smart_checkout` raises do-not-release) or **smart_checkout idempotency** (0021). Those are the highest-value additions next.

Related: [[suite-environment]], [[pickup-safety-0019]].
