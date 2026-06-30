---
name: allergy-field-folded-into-medical
description: As of 2026-06-17 (commit bbf1cee) signup dropped the separate Allergies field; new kids register with allergies=null and everything in medical_notes.
metadata:
  type: project
---

As of 2026-06-17 (commit `bbf1cee` "caregiver-friendly form"), the signup form's separate **Allergies** input was removed. New registrations write `allergies: null` and fold allergy text into **`medical_notes`** (one combined "Allergies & medical notes" box). The `students.allergies` column and the Zod `allergies` field still EXIST and are still selected/rendered everywhere — they're just empty for new kids.

**Why:** caregiver-friendly door-to-door signup; fewer fields. The author verified "no false-negative on the allergy surfaces" because allergy info now rides the loud Medical alert.

**How to apply:**
- At `/table/[code]`, the volunteer's allergy info for a NEW kid appears under the **Medical** callout (rose container), NOT the amber **Allergies** callout. The Allergies block only renders for OLD records that still have `allergies` populated. This is correct/graceful — `SafetyCallout` (`state-badge.tsx`) is fully null-safe (short-circuits both-null, renders each block only when truthy). No crash, no empty-but-alarming banner.
- Residual UX risk (NOT a code bug): a volunteer trained to scan the "Allergies" banner may overlook an allergy now buried in free-text Medical notes. If a dedicated allergy surface is ever wanted again, re-collect at signup — don't change the check-in render (it's fine).
- The check-in action surface (`student-actions.tsx`), lookup, and override are all independent of `allergies` — this change cannot break them.

Related: [[event-authz-matrix]], [[restricted-release-status]].
