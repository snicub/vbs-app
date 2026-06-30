---
name: review-branch-offline-routing
description: Context for the feat/vbs-safety-offline-routing-efficiency review session (photos+storage flow + test-coverage audit)
metadata:
  type: project
---

First task on this agent was a review-only flow + test-coverage audit on branch `feat/vbs-safety-offline-routing-efficiency`.

**Why:** User runs periodic per-flow reviews with newly-registered specialist agents; they want correctness findings + prioritized TEST GAPS, not edits (they were actively editing files).

**How to apply:** When asked to "review", default to read-only — do not edit. Deliver verdict + findings + test gaps (file + assertion) as the final message, no report files.

Domain state at review time (2026-06-17):
- `signedUrlsFor` batch helper is the path-keyed/null-safe one; consumed by `/coordinator`, `/coordinator/students`, `/van/[vanId]`. `signedUrlFor` (single) used by `/table/[code]` + student edit page.
- supabase-js storage v2.106 `createSignedUrls` returns `{ error: string|null; path: string|null; signedUrl: string|null }[]`. `signedUrl` can be null even when `error` is null.
- Only test in domain is `tests/unit/resize.test.ts` (covers `scaledDimensions` only — pure). `signedUrlsFor`'s pure path-mapping logic was UNTESTED.
- Photo upload at signup: `registerFamily` in `src/server-actions/registration.ts` ~line 184, path `${familyId}/${studentId}.jpg`, admin client `.upload(..., {upsert:true})`, best-effort (logs + continues on failure).
- No `getPublicUrl` anywhere in src — privacy boundary intact.
