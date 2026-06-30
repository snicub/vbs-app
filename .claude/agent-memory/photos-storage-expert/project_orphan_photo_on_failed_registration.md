---
name: orphan-photo-on-failed-registration
description: registerFamily compensating cleanup deletes DB rows only, not the uploaded photo — orphaned object left in private bucket on mid-chain failure. Accepted, no safety impact.
metadata:
  type: project
---

`registerFamily` (`src/server-actions/registration.ts`) is a non-transactional insert chain with a compensating `cleanupPartialFamily` on failure. Photo upload happens at the students step; the cleanup-triggering `fail()` calls AFTER it (day records, consents, access token) delete only DB rows via `partialFamilyDeletes` (consents → students → families). **No storage delete** — so a registration that uploads a photo then fails at a later insert leaves an orphaned object at `student-photos/${familyId}/${studentId}.jpg` pointing at a now-deleted student.

**Why:** `src/lib/registration/cleanup.ts` is deliberately DB-only + FK-ordered (this agent owns the helper; registration-flow-expert owns the insert chain). The storage delete was never wired into the registration owner's compensating path.

**How to apply:** Accepted gap, NOT a blocker — bucket is private (`0008`, public=false), the orphan is unreachable (no surviving row references it, no public path constructed), re-registration uses fresh UUIDs + `upsert:true`. It's a few KB of dead bytes on a rare path for a one-time ~100-kid event. If a complete fix is ever wanted: add `admin.storage.from("student-photos").remove([...])` in `cleanupPartialFamily` using the `inserted[]` ids in scope — coordinate with registration-flow-expert, don't put it in pure `cleanup.ts`. Related: [[project_photo_consent_gap]].
