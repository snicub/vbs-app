---
name: field-validation-rules
description: Registration field rules and their client/server mirror points (dob-or-age, van-requires-stop, optional-email, parent_pickup_only gap)
metadata:
  type: project
---

Validation lives in `src/lib/registration/schema.ts` (zod, server-authoritative) and is partially mirrored in the client form `src/app/signup/signup-form.tsx`.

- **dob-OR-age**: `StudentSchema.superRefine` requires `dob || ageAtRegistration != null`. Client mirrors in `onSubmit` (`missingDobAge` check). DB also enforces via `students_dob_xor_age` CHECK. Three layers, in sync.
- **van-requires-morning-stop**: schema guards ONLY `mode === "van"`. **Gap:** the form ALSO requires a morning stop for `parent_pickup_only` (a van-out mode) via a `required` <Select>, but the schema does NOT — a direct API call with `parent_pickup_only` + null morningStopId passes server validation. If hardening, extend the superRefine guard to `(mode === "van" || mode === "parent_pickup_only")` for morning stop, and `(mode === "van" || mode === "parent_dropoff_only")` for afternoon stop.
- **OptionalEmailSchema**: accepts valid email, "", or omitted. Used for `family.primaryEmail` and `guardian.email`. Blank `primaryEmail` stores `""` (column is `citext NOT NULL`); guardian blank stores `null` (that column is nullable). Guard `mailto:` against `""`.
- **phone required**: `PhoneSchema` (required on family + guardians) normalizes to E.164 via `normalizePhone` (10-digit→+1, 11-digit-w/1→+1, else +digits). Phone is the one required safety contact in the door-to-door model.
- **max 15 children per family**, **min 1**.

**Door-to-door optional fields**: photo, email, address, emergency contact all optional; live in a collapsible `<details>`. Phone stays required.
