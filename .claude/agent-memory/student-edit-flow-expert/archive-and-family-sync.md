---
name: archive-and-family-sync
description: Soft-archive model + family↔guardian sync direction, and two day-of edit gaps (assign false-success, address edit doesn't re-route).
metadata:
  type: project
---

Soft-archive replaced hard delete (migration 0026, `students.archived_at`). Verified 2026-06-29 (pre-VBS) production review.

**Why:** hard delete tried to delete append-only `student_day_events` (trigger-rejected) and would erase custody/consent history; soft-archive retains everything and is restorable.

**How archived kids are hidden EVERYWHERE in one place:** the `student_day_status` view inner-joins `students ON ... AND s.archived_at IS NULL` (0026 line ~137), so every view-driven screen (dashboard counts, van rider list, nametags, `/table/[code]`) drops them automatically. Plus belt-and-suspenders filters: roster list `.is("archived_at", null)` (students/page.tsx:44, archived shown separately :55), `lookupByWristband` (events.ts:262), `searchStudentsByName` (events.ts:350). The edit page loads archived kids WITHOUT the filter so they can be opened + restored (ArchivedBanner → unarchiveStudent).

**Archive live-custody guard** (students.ts:144-155): blocks archiving when today's state ∈ {van_boarded_am, arrived_at_site, site_checked_in, van_boarded_pm}. GAP: omits `site_checked_out` — a van kid checked out but not yet boarded PM would vanish from the van list if archived (narrow, author chose checked-out as "safe").

**Family↔guardian sync is ONE-DIRECTIONAL.** `updateFamilyContacts` (top "Family contacts" form) writes the family copy AND syncs the matched primary guardian row's full_name/email/phone (families.ts:203-221) — keeps STOP opt-out match (opt-out.ts matches guardians.phone too) + login email-match correct. BUT `updateGuardianPhone` (bottom per-guardian editor) updates ONLY `guardians.phone`, never `families.primary_phone` → editing the PRIMARY's number there leaves the family copy stale/drifted. Primary guardian is picked by name-match → relationship "primary" → guardians[0] (edit page:206-209); a name-drifted multi-guardian family can clobber the wrong guardian.

**Address edit ≠ re-route.** `updateFamilyContacts` clears lat/lng + geocode_failed_at on address change (families.ts:170-191); next build re-geocodes via `geocodeFamilyAddress`→`localPlace` (local reservation towns: Barker Hill / Long Hollow / Old Agency / Peever Flat, geocode.ts:38-50). BUT the builder + `assignStopsForMode` are NON-destructive (fill empty legs only; routing.ts:165-167 skips already-routed) — an already-assigned kid keeps their OLD van after an address change. Only manual "Assign to van" (assignStudentToVan, overwrites legs) or the Pickup Map actually moves them. Door-to-door softens this: drivers navigate by the live address on the rider list regardless of which van.

**Assign-to-van false success:** edit form van-section visibility uses the LOCAL unsaved `mode`, but `assignStudentToVan` reads the SAVED mode from DB. Flip dropdown to a van mode + click Assign BEFORE "Save today's plan" → assignLegsForVan(savedMode=parent_both) returns {} → ok:true → "Assigned to van" toast while kid is NOT routed. Save plan first.

See [[door-to-door-van-assign]], [[roster-surface-map]], [[name-rule-and-edit-screen]].
