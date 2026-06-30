---
name: allergies-edit-vs-signup
description: Signup dropped the separate allergies field (writes allergies=null, combines into medical_notes); the coordinator edit screen INTENTIONALLY keeps both — that divergence is by design.
metadata:
  type: project
---

As of commit bbf1cee (2026-06-17 "caregiver-friendly form"), the **signup form** combined allergies + medical into one "Allergies & medical notes" box stored in `medical_notes`, and writes `allergies: null` for every new child. The schema's `allergies` field still exists but signup never populates it.

The **coordinator edit screen** (`student-edit-form.tsx`) still has TWO separate inputs — a dedicated "Allergies (safety-critical)" textarea and a "Medical notes (safety-critical)" textarea — and `updateStudent` (`students.ts`) still maps `allergies` → `students.allergies` correctly.

**Why:** This divergence is the GOOD outcome, not a bug. Families type free-text into one box at signup; a coordinator can later split out / record a structured allergy on the edit screen. The `students.allergies` column is still live and writable; `SafetyPills` renders BOTH `allergies` and `medicalNotes` as loud alerts, so a kid with only `medical_notes` set (the new-signup default) still triggers the medical alert everywhere — no false-negative on the allergy surface.

**How to apply:** Do NOT "fix" the edit screen to drop allergies to match signup — that would remove the only place a structured allergy can be recorded. If anyone proposes consolidating, push back: the asymmetry is deliberate. Verify before acting that `students.allergies` is still selected in `page.tsx`/edit `page.tsx` and written in `updateStudent`.

Age cap was also raised to 99 (`StudentSchema.ageAtRegistration.max(99)`) so adult leaders/helpers can register — the roster age filter + age groups derive bounds dynamically from data, so they handle the wider range with no change. See [[roster-surface-map]], [[name-rule-and-edit-screen]].
