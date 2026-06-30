---
name: no-login-preconditions
description: The TWO silent preconditions no-login kiosk mode needs or every volunteer is locked out (flag string-exact + a coordinator row must exist)
metadata:
  type: project
---

No-login kiosk mode (`ALLOW_NO_LOGIN`) has TWO hard preconditions. If EITHER fails, every unauthenticated request resolves to `null` → all staff pages `redirect("/login")` → volunteers face an email+password form they have no account for → total lockout. Both fail SILENTLY (build/tests stay green):

1. **Flag must be the exact string `"true"`** — `src/lib/env.ts:43-46` transforms `v === "true"`. `"TRUE"`, `"1"`, `" true "`, or unset all become `false`. Vercel env is the only place this matters in prod; it can't be verified from the repo.
2. **At least one `admin`/`coordinator` row must exist in `public.users`** — `src/lib/auth/session.ts:57-67` returns the OLDEST such row as the synthetic actor; with zero rows it returns `null` (line 67). Seeded out-of-band via `pnpm set-role <email> coordinator`. An empty/reset prod users table = lockout even with the flag correctly on.

**Why:** Surfaced in the 2026-06-29 final pre-event review (VBS 6/30–7/2). The synthetic actor inherits a real coordinator/admin role, so once it resolves it satisfies every gate (page redirects, `isCoordinator`/`isStaff` server-action checks, admin-client writes via `createClient`, and `record_event`'s DB role re-verify). The whole risk is upstream: does it resolve at all. A direct prod-DB read to confirm precondition #2 is blocked by the prod-reads guard — must be verified by the user, not the agent.

**How to apply:** When asked "will kiosk mode work in prod," verify BOTH preconditions, not just the flag. The coordinator-row one is the quieter killer. See [[no-login-client-selection]].
