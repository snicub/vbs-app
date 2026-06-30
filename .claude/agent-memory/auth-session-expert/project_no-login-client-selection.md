---
name: no-login-client-selection
description: How createClient picks admin-vs-cookie-bound under ALLOW_NO_LOGIN, and why a stale -auth-token cookie used to blank pages
metadata:
  type: project
---

`src/lib/supabase/server.ts` `createClient()` selects the DB client BEFORE any role check:
- `ALLOW_NO_LOGIN=true` → ALWAYS return `createAdminClient()` (service role). This is the fix in commit `4a2b64c` (2026-06-18). Reason: in no-login there is no real auth session to satisfy RLS, so a cookie-bound anon client reads ZERO rows → every page blanks. A leftover/partial `-auth-token` cookie (e.g. from hitting `/login` once) must NOT flip the request onto the locked-down anon client.
- flag off + no `-auth-token` cookie → admin client (so `getSessionUser` can resolve and the page can redirect cleanly).
- flag off + has cookie → real cookie-bound, RLS-scoped client (signed-in staff).

**Why:** Under no-login, authorization is the `getSessionUser` role check + `isCoordinator`/`isStaff` gates in server actions, NOT RLS. The admin client is the intended posture there. Confirmed GO-LIVE: `record_event`/`smart_checkout` (migration 0012) re-derive `v_verified_role` from `public.users` and ignore caller-supplied `p_actor_role`, so no-login is "device access = on-file coordinator," not "forge any role." Residual risk is purely physical/network reachability of the deploy.

**How to apply:** If pages blank under no-login, this client-selection logic is the first place to look — don't assume a data bug. If anyone proposes gating routes in `src/middleware.ts` (it gates NONE today, only refreshes the cookie), remember authorization lives in `getSessionUser` + server-action role gates; a no-login public deploy must network-gate `/coordinator/*` at the Vercel/edge layer. See [[surface-drift]].
