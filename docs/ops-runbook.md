# Operations runbook

## Local dev from a fresh clone

1. Install: `pnpm install`
2. Start Docker (Supabase needs it)
3. Boot local Supabase: `pnpm supabase:start`
   - Note the printed `API URL`, `anon key`, `service_role key`.
4. Copy `.env.example` to `.env.local` and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<from above>
   SUPABASE_SERVICE_ROLE_KEY=<from above>
   ```
5. Apply migrations: `pnpm supabase:reset` (this also seeds via supabase/seed.sql if present)
6. Optional dev seed: `pnpm seed:dev` (5 stops + 5 vans + 10 sample families)
7. Run dev: `pnpm dev` → http://localhost:3000

## Tests

- `pnpm test` — unit tests (Vitest)
- `pnpm test:db` — pgTAP tests against local Supabase
- `pnpm test:integration` — Vitest against a running local Supabase
- `pnpm test:e2e` — Playwright; dev server auto-boots
- `pnpm check` — typecheck + lint + unit tests

## Pre-event week

1. Real Supabase project URL/keys → environment variables in Vercel
2. Twilio + Resend credentials → environment variables
3. Mapbox token if doing live geocoding/ETAs
4. Add `CRON_SECRET` and verify the day-before-reminder cron runs
5. Create coordinator + staff accounts:
   - Send them a magic link via `/login`
   - After they sign in, set `users.role` in Supabase Studio
6. Print the wristband sheet (after PDF feature lands) Sunday night as fail-safe

## Recovery playbook (during VBS week)

| Symptom                                           | Fix                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Volunteer says wristband code "doesn't work"      | Try name search on `/table`. Most likely a misread `0 vs O` (alphabet excludes them — escalate to coordinator to verify code) |
| Kid double-checked-in                             | Idempotency key dedupes by design. If the duplicate predates the idempotency change, coordinator can override-supersede.       |
| State stuck (kid is on PM van, app shows AM stop) | Coordinator `override` event with the actual current state and a reason                                                       |
| Family says they didn't get the reminder text     | Check `notifications_sent` for the family's record. STOP keyword sets `sms_opted_out_at`; coordinator can null it.            |
| Van GPS not updating                              | Aide phone may have backgrounded the page. They should reopen `/van/[vanId]` and tap **Start broadcast** again.               |
| Sign-in link expired / wrong email                | Resend from `/login`. Magic links are 10-minute single-use.                                                                  |
