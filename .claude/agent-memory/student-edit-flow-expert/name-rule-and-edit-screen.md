---
name: name-rule-and-edit-screen
description: The single-name/splitName/preferred-name rule and how the edit screen is shaped; per-section non-transactional saves; today-only plan limitation
metadata:
  type: project
---

**Name rule (authoritative, verified in code):** the app stores a single typed Name. `updateStudent` (students.ts) runs `splitName` (registration/schema.ts: last whitespace word → last name, rest → first; single word → empty last) and sets `preferred_first_name = null` on every name edit. The list + search still READ `preferred_first_name ?? legal_first_name`, so the null clear is what makes a rename stick everywhere. Do NOT reintroduce an editable preferred-name field.

**Edit screen shape (`/coordinator/students/[studentId]/edit`):** independent forms, each with its own save button and its own server action — NO atomic "save all", saves are last-write-wins:
1. Student info (name/allergies/medical) → `updateStudent`
2. Today's plan (attending + mode) → `updateStudentDayRecord` — renders only when a day-record exists for `getLocalDate()`; otherwise silently hidden with "may not be registered for today". Only operates on TODAY; can't create a missing day-record or edit another day.
3. Assign to a van (door-to-door) → `assignStudentToVan` — see [[door-to-door-van-assign]]. Renders only when mode rides a van.
4. Family contacts + per-guardian phones → `updateFamilyContacts` / `updateGuardianPhone` (admin client — see [[roster-surface-map]]).

There is NO `[studentId]/page.tsx` — per-student detail is `/table/[code]` (keyed by wristband code). The edit page's back link and header point there.

**Derived, never written:** the plan/van editors write mode + stop-leg IDs only; van + wristband color re-derive via the view on next read. The form never sends van/color.
