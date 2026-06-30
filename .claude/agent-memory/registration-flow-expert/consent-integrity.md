---
name: consent-integrity
description: Consent v3 active set, version history, and the min(3)-vs-set-equality guard weakness
metadata:
  type: project
---

`CONSENT_VERSION = "v3"` in `src/lib/consents/text.ts`. Active v3 kinds: **media_release, general_liability, medical** (medical reworded to guardian-reachable-in-emergency + first-aid authorization). v1/v2 retained verbatim for already-signed records.

Version history:
- v1: 5 kinds — media_release, medical, transport, general_liability, photo_release
- v2: same 5 kinds, plain-language reword
- v3: dropped transport + photo_release from the active set (3 kinds)

The DB `consent_kind` enum (`0002_core_tables.sql`) still defines all 5 — that's intentional so old rows validate; don't remove enum members.

Hashing: `hashConsentText` is plain SHA-256 hex of the canonical string, WebCrypto, runs in both browser and Node. The signup server component computes hashes from `CONSENT_TEXT[v3]`; `registerFamily` recomputes and rejects on mismatch ("Consent text has changed. Please reload.").

**Known open gap (audit-flagged, still true 2026-06-16):** photo is collected/uploaded at signup but NO active consent covers wristband-photo use (photo_release was dropped in v3). If photo use resumes as a real feature, a consent must come back → bump CONSENT_VERSION, add canonical text + hash, the form checkbox, and the insert chain together.

**Consent-KIND enforcement is NOW PRESENT in `registerFamily` (fixed; was audit-flagged as count-only).** As of 2026-06-16 review, `registration.ts` (~lines 35-46) computes `requiredKinds = Object.keys(CONSENT_TEXT[CONSENT_VERSION])` and rejects unless the submitted kind-set exactly equals it (size + every-member check) BEFORE the per-kind hash verification. The zod `min(3)` is now just a cheap first gate. Do not re-report "consents enforced by count not kind" — that's stale. See [[registerfamily-insert-chain]].

**How to apply:** any consent change touches text.ts (version + text), the signup server component's `kinds` derivation (already `Object.keys(CONSENT_TEXT[CONSENT_VERSION])` so it auto-picks up new kinds), the form's `CONSENT_LABELS`, and the insert chain — keep them in sync.
