---
name: parent-token-page
description: Parent /parent/[familyToken] page — token validation, one-family service-role projection, noindex (now present), no mailto on page
metadata:
  type: project
---

`src/app/parent/[familyToken]/page.tsx` is the deliberate RLS bypass. Flow:
1. admin-client lookup of `family_access_tokens` by token, selecting `family_id, revoked_at, expires_at`. `notFound()` if missing, revoked, or expired. (Good — validates revocation + expiry, not just existence.)
2. Service-role reads scoped to `token.family_id` only: `families` (id, primary_guardian_name), `students` (no allergies/medical/photo selected — good, no medical PII leak), then `student_day_status` for today filtered by the family's studentIds, plus van/stop/van_location name lookups.

Projection is correctly one-family-scoped. No medical/allergy columns are selected, so the parent page does not leak medical PII. The page does NOT render any email, so there is no `mailto:` on this page to guard (the mailto blank-guard the audit referenced is on the TABLE check-in contact block, not here).

**`noindex` is NOW PRESENT (fixed; was audit-flagged).** As of 2026-06-16 review, `page.tsx` exports `metadata = { title, robots: { index: false, follow: false } }`. The old "missing noindex" finding is resolved — do not re-report it. The route is also middleware-excluded.

`not-found.tsx` and `loading.tsx` exist; not-found shows coordinator phone. There is no parent-route `layout.tsx`.

**How to apply:** never widen the projection; if adding fields, keep them non-PII and family-scoped. Adding noindex is a one-line, safe hardening.
