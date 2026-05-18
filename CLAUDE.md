# VBS Check-In App

Safety-critical check-in and transportation tracker for a one-time Vacation Bible School event, late June 2026.

**Cost of a bug = a kid is unaccounted for.** Favor boring, reliable patterns over clever ones. No paper backup at runtime — the app MUST work Tuesday morning. PDFs are printed Sunday night as failsafe only.

## Scale

- ~100 kids, 5 vans, 5 pickup towns, 5 days, one church, one event
- Roles: parent, driver, aide, table volunteer, coordinator, admin
- Solo developer (the user) volunteering during VBS week — build for self-service recovery (coordinator can override anything without contacting them)

## Tech stack (locked, do not relitigate)

- Next.js 14 App Router + TypeScript strict (`noUncheckedIndexedAccess` on) + Tailwind v4 + shadcn/ui v4 (Base UI primitives). CSS-based theme via `@theme inline` in `globals.css`; no `tailwind.config.ts`.
- Supabase (Postgres / Auth via magic link / Realtime / Storage / RLS)
- Twilio (SMS), Resend (email), Mapbox (geocoding + Directions Matrix for ETAs)
- Vercel (host), Sentry (errors), UptimeRobot (uptime)
- pnpm
- Mobile-first responsive; test at 375px / 768px / 1280px

## Architecture (load-bearing)

### Source of truth: append-only event log

`student_day_events` is immutable. **No updates, no deletes.** Corrections are new events with `superseded_by_event_id` pointing back. Every event has `idempotency_key` (unique), server-side `occurred_at`, `actor_user_id`, `actor_role`, optional `override_reason`.

### Single write entry point: `record_event` Postgres function

ALL event writes go through this function. It:

1. Walks the event log to derive current state for `(student_id, event_date)`
2. Rejects illegal state transitions
3. Allows illegal transitions ONLY when `override_reason` is set AND actor is coordinator/admin (logged as override)
4. Dedupes on `idempotency_key`
5. Uses `pg_advisory_xact_lock(hashtext(student_id::text || event_date::text))` for serialization
6. Returns the new derived state

**No client-side direct writes to `student_day_events`.** All event writes go through this function via a server action.

### State machine

```
not_started → van_boarded_am → arrived_at_site → site_checked_in
            ↘ parent_dropoff → site_checked_in
                                  ↓
                           site_checked_out
                                  ↓
                       van_boarded_pm → van_offloaded_pm → home
                       parent_pickup → home

(from not_started) → no_show → marked_no_show
                              (terminal, escapable only via override)
```

Events: `van_boarded_am`, `van_offloaded_am`, `site_checked_in`, `site_checked_out`, `van_boarded_pm`, `van_offloaded_pm`, `parent_dropoff`, `parent_pickup`, `no_show`, `override`.

The state machine is mirrored in TS at `src/lib/events/state-machine.ts` for UI hints only — the Postgres function is the authoritative guard.

### Derived state via `student_day_status` view

App reads use this view, never the raw event log. It computes current state from events plus exposes derived `morning_van_id`, `afternoon_van_id`, `wristband_color_for_day` (afternoon stop color → morning stop color → null) and the four anomaly flags below.

### Anomaly flags (boolean columns on `student_day_status`)

- `is_late_am`: attending=true but no AM event by `scheduled_am_time + 45min`
- `is_boarded_but_not_arrived`: `van_boarded_am` with no `site_checked_in` after 30min
- `is_in_but_not_out`: `site_checked_in` with no `site_checked_out` past PM start
- `is_pm_van_stuck`: `van_boarded_pm` with no `van_offloaded_pm` 2h after departure

## Data model

Tables (see `supabase/migrations/` for canonical schema):

- **`families`** — primary guardian, address (lat/lng), emergency contact, `sms_opted_out_at`
- **`guardians`** — per-family, `user_id` FK to `auth.users` (nullable, populated on first magic-link sign-in by email match)
- **`authorized_pickup_persons`** — incl. `is_restricted` for "do not release to"
- **`students`** — legal + preferred names, allergies, medical notes, `wristband_code` (unique, 5-char alphanumeric, checksum, excludes 0/O/1/I/l)
- **`consents`** — snapshotted text + hash, typed name, IP, UA
- **`stops`** — name, town, address (lat/lng), `color_code`, `color_name`, scheduled AM/PM
- **`vans`**, **`routes`** (van + direction + ordered stop_ids), **`van_assignments`** (per-date driver + aide)
- **`student_day_records`** — per `(student, date)` plan: attending, mode, stops. `morning_van_id`, `afternoon_van_id`, `wristband_color_for_day` are NOT stored — derived via the view.
- **`student_day_events`** — append-only, the source of truth
- **`family_access_tokens`** — random UUID per family for read-only parent status page
- **`van_locations`** — one row per van, upserted on each report
- **`notifications_sent`**, **`incidents`**, **`daily_closeouts`**, **`users`**

### Critical schema rules

- Wristband codes: 5-char alphanumeric, last char = checksum, exclude `0 O 1 I l`
- `students` uniqueness in family: two partial indexes — `(family_id, lower(first), lower(last), dob)` when `dob IS NOT NULL`, and `(family_id, lower(first), lower(last), age_at_registration)` when `dob IS NULL` (Postgres treats NULL != NULL so a single index with nullable dob fails open)
- `families.primary_email` is NOT unique (real life has shared emails)
- All photos in private storage buckets, signed URLs only, short TTL
- Primary keys: UUIDv7 generated in Node (`uuidv7` package) for time-ordered IDs; DB defaults to `gen_random_uuid()` for direct inserts (seeds, migrations)

## RLS policies (not optional)

- **Parent** — own family only. Match `auth.uid()` to `users.id` and to `guardians.user_id`
- **Driver** — read-only manifest for the van assigned today
- **Aide** — read manifest + write events for kids on assigned van + broadcast location
- **Table volunteer** — read all students, write only `site_checked_in` / `site_checked_out`
- **Coordinator** — full read/write + override
- **Admin** — everything

Parent magic-link page (`/parent/[familyToken]`) bypasses RLS: server-side validates the token against `family_access_tokens`, then queries via the service role and returns only that family's projection.

## Decisions locked in

1. **Guardian login** ties magic-link auth user to the guardian record on first sign-in via email match
2. **Parent status page** = long random URL, no password
3. **No-show flow** — volunteer marks AM, only coordinator can reverse
4. **Van assignments per-day**, not a static field on the staff user
5. **Wristband color**: afternoon stop → morning stop → "P" badge (derived in the view, not stored)
6. **Photos** uploaded by parent at signup, client-resized to ≤800px JPEG; coordinator can replace
7. **Van GPS** persisted (one row per van, upserted) — not broadcast-only
8. **Realtime** enabled on `student_day_events`, `student_day_records`, `van_locations` (REPLICA IDENTITY FULL)
9. **Day-before reminder** via Vercel Cron at 19:00 the prior day
10. **Two families can share an email** — magic link goes to address on file
11. **STOP keyword respected** — `families.sms_opted_out_at`
12. **Race protection** via `pg_advisory_xact_lock` in `record_event`
13. **Tests** — Vitest (unit + integration against local Supabase) + pgTAP (for `record_event`) + Playwright (E2E)
14. **Storage** — two private buckets: `student-photos`, `wristbands`. Signed URLs only.
15. **All writes through server actions** (`'use server'`). Browser supabase-js is allowed only for Realtime subscriptions and Storage signed-URL fetches.

## Build phases

1. **Foundation** — scaffold, schema, RLS, `record_event`, seed, tests. **Hard stop for user review.**
2. **Registration** — multi-step signup, family editing, wristband code generation, confirmation SMS/email
3. **Check-in flows** — table dashboard, van manifest, aide location broadcast, realtime
4. **Coordinator + safety nets** — today view with anomalies, manual overrides, end-of-day closeout, announcements, PDFs
5. **Notifications + polish** — full SMS map, parent status page, geocoding recommendations, offline queue, load test

Each phase ships in increments small enough to review. No bundling.

## Project structure

```
vbs-app/
├── CLAUDE.md
├── docs/
│   ├── consent-text-v1.md       (canonical, hashed at build time)
│   ├── state-machine.md
│   └── ops-runbook.md
├── supabase/
│   ├── migrations/              (0001..0008 in order)
│   └── tests/record_event.sql   (pgTAP)
├── scripts/
│   ├── seed-dev.ts
│   └── consent-hash.ts
├── tests/{unit,integration,e2e}/
└── src/
    ├── app/                     (routes per spec)
    ├── components/{ui,forms,checkin,van,coordinator}/
    ├── lib/
    │   ├── env.ts               (zod-validated process.env)
    │   ├── supabase/{client,server,admin,types}.ts
    │   ├── events/{state-machine,record-event,derive}.ts
    │   ├── wristband/{generate,validate}.ts
    │   ├── notifications/{send,templates,opt-out}.ts
    │   ├── consents/{text,hash}.ts
    │   ├── auth/roles.ts
    │   ├── idempotency.ts        (uuidv7)
    │   ├── geo.ts                (Mapbox)
    │   └── pdf/                  (wristband sheet, manifest, roster)
    ├── server-actions/           (the ONLY writers — wraps record_event etc.)
    └── types/
```

## How to work with this user

- **Senior frontend engineer.** Fluent in TS / React / Next.js. Don't explain framework basics.
- **Strict about scope creep.** No features they didn't ask for. No premature abstractions. Three similar lines beats a premature helper. No backwards-compat shims when you can just change the code.
- **Plain language, not DB/infra jargon.** When listing options or defaults, describe what the user/system *does* — not the implementation. Avoid Postgres internals (advisory locks, partial indexes, REPLICA IDENTITY, view vs. materialized view) unless they're actively deciding *about* that mechanism. They want to evaluate decisions by user-visible effect.
- **Narrow questions.** Do NOT list 10+ questions at once. Ask only what truly blocks the next concrete step (often just one). For everything else, pick a sensible default, state it inline, and invite per-item pushback. They'd rather correct a default during the next increment's review than answer a long list before any code lands.
- **Autonomous build mode** (per 2026-05-18 direction). Do NOT stop between sub-steps or phases to ask for approval. Make sensible defaults autonomously. Only stop when a third-party credential is genuinely required (Twilio/Resend/Mapbox/Supabase URL) or when the work is complete. Commits can bundle related work — the user reviews via CLAUDE.md, not per-commit. Keep CLAUDE.md "Current status" section up to date.
- **Test as you go** (per 2026-05-18 direction). Every business-logic module ships with tests in the same commit. Vitest for unit + integration, pgTAP for `record_event`, Playwright for E2E. Run `tsc --noEmit && pnpm test` before any commit that changes business logic. Don't let it slide — the cost of a bug here is a kid is unaccounted for.
- **Communication style.** Concise. Direct. Don't narrate internal deliberation. End-of-turn summary = one or two sentences max.

## Things the user will provide later (don't hardcode)

- Church name and branding
- Coordinator name + phone
- The 5 stop addresses + town names
- VBS exact start/end dates
- Age/grade range
- AM start time + PM end time
- Twilio account credentials
- Resend API key
- Mapbox token

## Rules — do NOT

- Skip RLS policies (they're not optional)
- Use mutable boolean state fields (always derive from event log)
- Build the live van map until everything else works
- Bundle phases — increments small enough to review
- Write tests last — write `record_event` tests as you build it; that function is the heart of the app
- Add error handling, fallbacks, or validation for scenarios that can't happen
- Add comments explaining WHAT code does — names should do that
- Use `--no-verify`, `--amend`, or other destructive git operations unless explicitly asked

## Where to look for prior context

User-level preferences and prior conversation memories live at:

```
~/.claude/projects/-Users-danhan-Documents-Code-church/memory/
```

These do NOT auto-load from inside `vbs-app/` (auto-memory is project-scoped to the directory Claude is launched from). The most load-bearing pieces are baked into the "How to work with this user" section above. If you need more, read that directory.

## Current status (2026-05-18 — autonomous build pass complete)

All 5 phases have a working first-cut shipped on `main`. **71 unit tests + 20 pgTAP assertions pass; typecheck, lint, build all clean.**

### What's wired up

**Phase 1 — Foundation**
- 8 SQL migrations in `supabase/migrations/`: extensions, core tables, append-only event log, `record_event()` function with state-machine guards + advisory locking + idempotency + override path, `student_day_status` derived view with 4 anomaly flags, RLS for every table, realtime publication, private storage buckets.
- pgTAP suite (`supabase/tests/record_event.sql`) — 20 assertions for happy path, idempotency, illegal transitions, override gate, supersession, terminal states.
- Lib modules with tests: `events/state-machine` (TS mirror), `wristband/{alphabet,checksum,generate,validate}`, `consents/{text,hash}`, `idempotency` (uuidv7), `anomaly`, `notifications/{send,templates,opt-out}`, `auth/{roles,session}`, `registration/{schema,dates}`, `env`.
- Supabase clients: browser, server (cookie-bound), admin (service role), middleware refresher.
- Sentry SDK plumbed (client/server/edge configs + `instrumentation.ts`); no-op without DSN.
- Vitest 3 + jsdom 26 + Playwright config. `pnpm check` = typecheck + lint + unit tests.

**Phase 2 — Registration**
- `/signup`: single-page form. Server component fetches stops + computes consent text hashes; client component handles family info, emergency contact, multi-child array, transport per child, 5 consents + typed name. Writes through `registerFamily` server action: family → guardians → pickup contacts → students (with collision-free wristband codes) → student_day_records for each VBS date → consents (with text hash, IP, UA) → family_access_token.
- Schema-level guards: requires dob OR age; van mode requires morning stop; all 5 consents required.

**Phase 3 — Check-in flows**
- `/table`: wristband-code primary entry, name-search fallback. `lookupByWristband` validates against the alphabet/checksum before any DB hit.
- `/table/[code]`: state-aware action surface, allergy/medical callouts, coordinator-only override panel (event picker + required reason).
- `/van` → `/van/[vanId]`: per-day manifest for the user's assigned van (or van picker for coordinators). GPS broadcast via `navigator.geolocation.watchPosition` → `broadcastVanLocation` upserts `van_locations`.

**Phase 4 — Coordinator**
- `/coordinator`: today view with anomaly section at top, count-by-state, full roster. Realtime subscription on `student_day_events` + `student_day_records` refreshes on any change.
- `/coordinator/closeout`: snapshots pending anomalies and writes `daily_closeouts`; supports reopen.
- `/coordinator/announcements`: broadcast SMS to every non-opted-out family.

**Phase 5 — Notifications + parent page**
- `/parent/[familyToken]`: token-validated public status page (middleware-excluded). Service-role read for that family only.
- `POST /api/twilio/inbound`: TwiML response; handles STOP/START via `handleInboundSms`.
- `POST /api/twilio/status`: delivery callbacks update `notifications_sent.status`.
- `POST /api/resend/webhook`: email events map to status.
- `GET /api/cron/day-before-reminder`: Vercel cron path declared in `vercel.json`, runs at 19:00 daily; auth via `Bearer CRON_SECRET` when set.

### What is deliberately not built yet

- **PDFs** (wristband sheet, manifest, roster). Defer — printed Sunday-night fail-safes.
- **Mapbox geocoding + ETAs** — need Mapbox token.
- **Live van map** — explicit "build last" per spec.
- **Coordinator family/student edit screens** — coordinators can use `/table/[code]` for daily actions; admin DB edits via Supabase Studio cover the rest for now.
- **Photo upload UI** — schema supports it (`students.photo_path`, `student-photos` bucket); UI deferred.
- **E2E tests** beyond a smoke test — Playwright config + 3 smoke specs land in `tests/e2e/`; full flows need a seeded Supabase to be useful.

### To run from a fresh clone

```
pnpm install
docker desktop start
pnpm supabase:start            # prints anon + service_role keys
cp .env.example .env.local     # fill in keys from above
pnpm supabase:reset            # apply migrations
pnpm seed:dev                  # idempotent dev seed
pnpm dev
```

See `docs/ops-runbook.md` for the recovery playbook during VBS week.

### Files most worth reading before changing anything

1. `supabase/migrations/0004_record_event_fn.sql` — the single write entry point. The state machine + override path are encoded here.
2. `supabase/migrations/0006_rls_policies.sql` — all the access scoping in one place.
3. `src/lib/events/state-machine.ts` — TS mirror; keep in sync with 0004.
4. `src/server-actions/events.ts` — only client-facing event writer.
5. `src/app/coordinator/page.tsx` — the operational center of the UI.
