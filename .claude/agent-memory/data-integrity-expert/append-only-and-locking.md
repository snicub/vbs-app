---
name: append-only-and-locking
description: Append-only enforcement, the supersede escape hatch, and the idempotency-before-lock ordering in record_event.
metadata:
  type: project
---

**Append-only enforcement (0003):** triggers `student_day_events_no_update` / `_no_delete` call `_reject_event_mutation()` (raises P0001) on ANY update/delete. The single exception is `_mark_superseded(predecessor, successor)` — SECURITY DEFINER, sets `session_replication_role = replica` to bypass the trigger, and only sets `superseded_by_event_id` once (`where superseded_by_event_id is null`). The unique index `student_day_events_idempotency_uidx` enforces idempotency-key uniqueness at the storage layer (a true backstop independent of the function logic).

**Lock vs idempotency ordering in `record_event` (live 0017):** the idempotency dedup read (lines 142-159) runs BEFORE `pg_advisory_xact_lock` (line 170). So two concurrent calls with the same key, before the first commits, can BOTH miss the dedup read. This is fine — the unique index makes the second INSERT fail. Net effect of a true concurrent replay: one succeeds, the other gets a unique-violation error (not a silent double-insert, and not a clean "was_idempotent" return). Acceptable for retries, but a same-key concurrent replay surfaces an error rather than the idempotent success path. Also note: **dedup runs before authz** — a replayed key returns success without re-checking authorization (fine for true retries).

The advisory lock key is `hashtext(student::text || ':' || date::text)` — per (student, date), enabling concurrent check-ins of different kids. This is the load-bearing concurrency guarantee; do NOT serialize globally or force single-instance.

**The no-delete trigger also blocks the admin/service-role client.** A raw `admin.from("student_day_events").delete()` (PostgREST → service_role, runs `session_replication_role = origin`) STILL hits `_no_delete` and raises P0001 — only `_mark_superseded` (SECURITY DEFINER, sets replica) bypasses it. So any "hard delete a student" path that tries to clear event history first will fail for every kid who has ever had an event. Corollary for delete/cleanup features: a junk student must be SOFT-archived (a flag filtered from rosters/counts/manifests), never row-deleted — a hard delete would also destroy the immutable custody trail + the family-scoped signed consents (typed name/IP/UA/hash), both of which must be retained. `student_day_events.student_id` is ON DELETE RESTRICT (0003:20); `student_day_records` cascades, `anomaly_notifications` cascades, `incidents.student_id` set-null. (Observed 2026-06-28 in uncommitted deleteStudent WIP — would hard-fail AND erase required records.)

See [[smart-checkout-divergences]] (which has NO idempotency at all) and [[live-function-versions]].
