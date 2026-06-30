---
name: public-registration-data-integrity
description: Data-correctness facts about the PUBLIC unauthenticated registerFamily insert chain — non-transactional orphan risk, wristband collision handling, RLS bypass via service role, no rate limit.
metadata:
  type: project
---

`registerFamily` (`src/server-actions/registration.ts`) is a PUBLIC, unauthenticated server action that writes via `createAdminClient()` (service role → RLS fully bypassed). It is a non-transactional sequential insert chain: family → guardians → pickup → students(+photos) → student_day_records → consents → family_access_tokens.

**Why:** Door-to-door + at-home signup for a one-time event; no parent auth exists (families never log in, they use the token URL). Service role is the only way an anon caller can write, by design.

**How to apply (the orphan blast radius — verified 2026-06-17):**
- Each step returns early on error WITHOUT rolling back prior inserts. A mid-chain failure (parent loses signal after family insert) orphans everything before the failure point.
- Worst orphan: a `families` row with NO `family_access_tokens` (token is the LAST insert, step 7) → that family has no working parent status URL and no error surfaced to the parent except a toast.
- Students can exist with no `student_day_records` (records are step 5, after students step 4) → kid is registered but appears on no day's roster/manifest.
- Consents can be missing (step 6) → legally-signed record absent though child is registered.
- Retry is NOT idempotent: families.primary_email is intentionally non-unique and there is no family-level dedup, so a parent who retries after a partial failure creates a SECOND full family. Duplicate families/students/wristbands accumulate silently.
- The per-family name+age unique index (`students_no_dup_by_dob` / `students_no_dup_by_age`) only blocks dup children WITHIN the same family row — it does NOT catch a re-submitted family (new family_id).

**Wristband collision handling (sound):** per-student loop, 16 attempts, regenerate code on 23505 whose message contains "wristband" (matches index `students_wristband_code_uidx`); a 23505 WITHOUT "wristband" is treated as the dup-child index and returns a clear "already registered" message. Collision space is 32^4 = ~1M payloads for ~100 kids → negligible collision rate; 16 retries is ample. The match is string-fragile (depends on PostgREST putting the constraint name in `.message`) but currently correct because only the wristband index name contains the substring "wristband".

**No rate limiting / CAPTCHA** on this public endpoint (grep: none). A malicious caller can mass-insert families/students/consents and burn storage (photo upload, upsert:true). Cannot escalate role (no users/role write here) and cannot read other families (writes only; returns only the just-created family's token). Schema/Zod hold: consent KINDS pinned to CONSENT_VERSION=v3 (3 kinds), hashes recomputed server-side, version pinned.

**No DB CHECK/NOT NULL a valid submission violates:** single-word child name → last="" satisfies NOT NULL text; dob-xor-age enforced both layers; wristband format regex `^[A-Z2-9]{5}$` is a superset of the alphabet output. Photo upload failure is swallowed (logged, continue) — does not abort the chain.

Related: [[append-only-and-locking]] (this path does NOT touch the event log — these are relational tables), [[null-stop-van-color-derivation]] (van kids registered here write NULL stops).
