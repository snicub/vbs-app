---
name: family-guardian-split
description: families.primary_* vs guardians rows are decoupled — editing one does not touch the other; what each NOT-NULL column means for the parent page and SMS
metadata:
  type: project
---

`families.primary_guardian_name / primary_email / primary_phone` are denormalized contact fields on the `families` row, SEPARATE from the `guardians` table rows.

- Registration (`src/server-actions/registration.ts`) writes BOTH: family.primary_* (step 1) AND a guardians row per guardian (step 2). The guardian's `email` is what magic-link auth matches `auth.users` against on first sign-in (decision #1); `families.primary_email` is just display/contact.
- The coordinator edit screen has TWO independent actions in `src/server-actions/families.ts`: `updateFamilyContacts` (edits family.primary_* + address + emergency contact, NEVER touches guardians) and `updateGuardianPhone` (edits a single guardians row). So a contacts edit can drift family.primary_phone away from the guardians row — only family.primary_* feeds the parent page header + SMS recipients; guardians feeds auth matching.

**NOT-NULL columns (migration 0002):** `primary_guardian_name`, `primary_email` (citext, NOT unique), `primary_phone`. Blank email stores `""` (door-to-door pattern), never null. `street_address`, `city`, `state`, `postal_code`, `lat`, `lng` are all nullable.

**Parent token page** (`/parent/[familyToken]/page.tsx`) selects ONLY `id, primary_guardian_name` from families (no email/phone/address — no PII leak there). It `notFound()`s if the family row is gone, but renders fine for a family with zero students (empty student list, header still shows). See [[parent-token-page]].

**Geocode coupling:** `updateFamilyContacts` nulls `families.lat/lng` when street/city changes so the next "Suggest vans from addresses" re-geocodes. Registration writes address with NULL lat/lng (geocoding only runs at the route builder, never inline).
