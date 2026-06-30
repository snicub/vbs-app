---
name: student-soft-archive
description: Students have a soft-archive (students.archived_at) added in 0026 — replaces the old unsafe hard deleteStudent; archived kids hidden via the view + direct-read filters.
metadata:
  type: project
---

Students are removed via SOFT ARCHIVE, not hard delete. Shipped 2026-06-28 (migration 0026).

**Why:** the old `deleteStudent` tried to `delete from student_day_events`, which the append-only trigger `student_day_events_no_delete` (0003) rejects — so it was broken AND would have erased custody + consent history. User approved a soft archive instead: archived = hidden from rosters/operational screens, every record RETAINED, coordinator can restore.

**How to apply / mechanism:**
- `students.archived_at timestamptz` nullable, no default. null = active. Set = archived.
- `student_day_status` view (0026) excludes archived students with a single added line: `join public.students s on s.id = r.student_id and s.archived_at is null`. This is the one place that hides archived kids from every screen that fetches students by ids the view returned (dashboard, nametags, vans/assign, groups, print, van/[vanId], anomaly-watch cron) — those use `.in("id", studentIds)` so the view filter covers them. Do NOT also filter those reads.
- Screens that drive off `students` DIRECTLY each got their own `.is("archived_at", null)`: `/coordinator/students` roster page, `lookupByWristband` + `searchStudentsByName` (both in `src/server-actions/events.ts`). An archived kid's wristband returns "No student found".
- DELIBERATELY NOT filtered: the edit page reads (`students/[studentId]/edit/page.tsx`) — an archived kid's edit page must stay reachable to restore them; the parent token page (`parent/[familyToken]` — family-scoped, read-only, their own kid's history, not an operational roster); `updateStudentPhoto` + `check-out.ts` + `registration.ts` (by-explicit-id, not roster scans).
- Actions: `archiveStudent` / `unarchiveStudent` in `src/server-actions/students.ts` — coordinator-gated, single UPDATE through the cookie-bound client (no admin client, no event-log touch, no FK ordering). Return shape `ArchiveStudentResult` (was `DeleteStudentResult`).
- UI: edit screen's "Danger zone" → "Remove from roster" (archive, confirm dialog, redirect to roster). When `archived_at` set, an amber `ArchivedBanner` with "Restore to roster" shows and the archive section is hidden. Roster has a "Archived (N)" toggle to view + restore.
- No pure helper extracted (single UPDATE) → nothing new to unit-test; verified by full suite (443 tests) + tsc + lint + build green.
- The view migration is Docker-UNVERIFIED (no local DB). Diff vs 0023 = exactly one added join line (verified byte-correct 2026-06-29: `diff` shows ONLY `join public.students s on s.id = r.student_id and s.archived_at is null` added at 0026:137; inner join is safe — FK guarantees 1 student/record, only archived rows filtered, no non-archived kid dropped; dashboard reads view first then `.in("id", studentIds)` so counts stay consistent).

**OPEN SAFETY GAP (found 2026-06-29): `archiveStudent` has NO live-custody guard.** It's an unconditional single UPDATE (`students.ts:119-141`). Archiving a kid who is currently `site_checked_in` / `van_boarded_am` / `van_boarded_pm` makes them vanish from EVERY operational surface at once — dashboard counts, the van rider list, the needs-attention/anomaly list, and their wristband returns "No student found" at the table — with no warning, because all of those drive off the archive-filtered view. That's the exact silent-loss the architecture exists to prevent (event log is retained, so recoverable by un-archiving, but mid-day the present child is invisible). Recommended fix: block or hard-confirm archive when the student has any non-terminal event for today (anything that isn't `home`/`no_show`).

See [[live-function-versions]] and [[append-only-and-locking]].
