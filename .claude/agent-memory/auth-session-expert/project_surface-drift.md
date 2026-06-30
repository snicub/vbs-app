---
name: surface-drift
description: Where the auth-session-expert briefing/CLAUDE.md drifts from the actual code (stale references to verify before acting)
metadata:
  type: project
---

The auth/session domain briefing and CLAUDE.md (0012 notes) reference an **auth callback route that validates the `next` param (no open redirect)**. That route (`src/app/auth/callback/route.ts`) was DELETED on `main` in commit `a3aa260` (2026-06-18 audit) — confirmed gone, no `exchangeCodeForSession`, no next-param handling, no lingering refs (grep clean). It died with the magic-link / email-code flow when sign-in moved to email+password (`src/server-actions/auth.ts`, `signInWithPassword`). The open-redirect surface is therefore gone, not just untested. (`/login` still exists and gates via `getSessionUser` → `routeForRole`, but it's a dead path in no-login deploys.)

**Why:** Staff auth was simplified to email+password set out-of-band via `pnpm set-password`; families never sign in (they use the no-login token status URL). The "email code" mentioned around the register rework is staff auth, not family.

**How to apply:** Don't recommend writing/maintaining a test for the auth-callback open-redirect — the route is gone. Before citing the callback or the magic-link flow as current, grep first. `promote-coordinator.ts` is fully subsumed by `set-role <email> coordinator` (redundant, harmless). See [[test-coverage-gaps]].
