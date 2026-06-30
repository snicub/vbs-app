---
name: registerfamily-insert-chain
description: Exact registerFamily insert order, the compensating-delete cleanup (no longer fully non-transactional), and the consent-kind verification gap
metadata:
  type: project
---

`registerFamily` in `src/server-actions/registration.ts` is the only registration writer. It is a **public, unauthenticated** server action using the admin (service-role) client — correct for self-service signup, but it means no session gate and (as of 2026-06-16) **no rate limiting or captcha**.

The family-facing form is on the **homepage** (`src/app/page.tsx` renders `SignupForm`); `/signup` is now a `redirect("/")` shim for old links. Homepage derives consent `kinds` from `Object.keys(CONSENT_TEXT[CONSENT_VERSION])` so the form, hashes, and `validateConsentSet` stay in lockstep.

Insert order (each step returns early on error):
1. `families` (one row) — `primary_email` stored as `data.primaryEmail || ""` (citext NOT NULL). `state` arrives hard-set to "SD" from the client; ZIP not collected.
2. `guardians` (bulk)
3. `authorized_pickup_persons` (only if non-empty)
4. `students` — per-student loop, up to 16 attempts regenerating `wristband_code` on 23505. Error classification extracted to `src/lib/registration/insert-error.ts` `classifyStudentInsertError` (tested): checks BOTH `message` AND `details` for "wristband" → `retry_wristband`; any other 23505 → `duplicate_child` (fail fast, friendly msg); non-23505 → `fatal`. **`allergies` is now ALWAYS null from signup** — the form dropped the separate allergies box; everything goes in `medical_notes` (textarea placeholder names allergies/meds/conditions). Verified no downstream consumer assumes allergies is populated — all read `?? null` and `SafetyPills`/`MedicalCell`/`SafetyCallout` short-circuit on null.
5. Photo upload to `student-photos` bucket (after students; failures logged + skipped, non-fatal)
6. `student_day_records` — one per (student, VBS_DATES date), stops NULL (routing built later)
7. `consents` — bulk; `typed_name` auto-set to `primaryGuardianName`; ip from x-forwarded-for, ua from header
8. `family_access_tokens` (one row) → builds `familyStatusUrl`
9. **Confirmation SMS is now AWAITED** (was fire-and-forget). `sendConfirmationSms` swallows its own errors, so awaiting can't fail registration — it just guarantees the attempt completes before the response. Template carries the status URL + "Reply STOP to opt out."

**Compensating cleanup (NEW, 2026-06-17 commit `4a2b64c`/`bbf1cee`):** on any failure AFTER the family row exists, `cleanupPartialFamily` runs `partialFamilyDeletes` (`src/lib/registration/cleanup.ts`, tested) in FK-safe order: **consents → students → families**. Order verified correct against `0002`: `consents` + `students` are `ON DELETE RESTRICT` against families (must go first); deleting `students` cascades `student_day_records`; deleting `families` cascades `guardians` + `authorized_pickup_persons` + `family_access_tokens`. Cleanup is best-effort (logs + stops on first delete error). **This closes the orphan-family risk for the common mid-chain failure** but is NOT atomic — a crash/timeout DURING the chain (before `fail()` runs), or a cleanup delete that itself fails, can still orphan. A true `rpc`/transaction is still the only full fix.

**Consent-kind verification — CLOSED.** `validateConsentSet` (`src/lib/registration/consent-check.ts`, tested) does version-pin + exact kind-set equality (count + Set size + every-member) BEFORE the per-kind hash recompute. Three copies of one kind, omitting a kind, or a stale `textVersion` all reject. Keyed off `CONSENT_VERSION` so a future bump auto-adjusts. See [[consent-integrity]].

**Double-submit duplicate risk (flagged 2026-06-29):** the network-failure `catch` in `signup-form.tsx` (re-enables the button + "tap Register again") + the AWAITED confirmation SMS (widens the round-trip) means: if attempt 1 fully commits server-side but the response is lost, the parent re-taps → attempt 2 inserts a **brand-new family row** (new `family_id`). The per-family student dedup indexes `students_no_dup_by_dob`/`_by_age` (0002:122-128) are scoped to `family_id`, so a second family NEVER collides → the kid is created TWICE (two families, two tokens, two wristband codes, two sets of day-records). `classifyStudentInsertError`'s `duplicate_child` path only fires within the SAME family, which a retry never is. Fail-safe direction (duplicate, not missing — kid still shows for 6/30, just twice), but no idempotency guard on the family insert. A true fix needs a client idempotency key threaded to a dedup on `families`. Coordinator can merge/delete dupes manually meanwhile.

**Status-link delivery risk (NEW, flagged 2026-06-18):** the success screen was trimmed to "You're all set! / Register another" — it NO LONGER shows the status URL or wristband codes. The status link is now delivered ONLY via the confirmation SMS. `sendSms` (`src/lib/notifications/send.ts`) does NOT throw on Twilio failure and, when Twilio creds are absent, only logs `status:"queued"` to `notifications_sent` and sends nothing. So if Twilio is unconfigured or a send fails, the parent loses their only path to the status page (a coordinator can still recover it from `family_access_tokens` by hand). Twilio is NOT set in local `.env.local`; verify prod Vercel env has it before relying on this. Acceptable for a one-time event IF prod Twilio is confirmed live; otherwise a real regression.
