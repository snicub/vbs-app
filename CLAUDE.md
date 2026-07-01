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

## Agent team (16 specialists — delegate by flow)

This app is maintained via flow-specialist subagents in `.claude/agents/`, each with durable cross-session memory in `.claude/agent-memory/<name>/`. When working on a flow, delegate to its owner (build/review/audit); for an app-wide pass, dispatch them per flow and cross-reference. (Supersedes the stale "9/12 agents" notes in the dated entries below — current roster is 16.)

- **registration-flow-expert** — `/signup`, registerFamily, consents, parent token page
- **check-in-flow-expert** — `/table` + `/table/[code]`, action surface, override/Undo, release
- **van-flow-expert** — `/van/[vanId]` driver/aide experience, AM board + PM checkout, GPS broadcast
- **van-management-expert** — `/coordinator/vans/manage` fleet setup: vans, routes, per-day driver/aide
- **live-map-flow-expert** — `/coordinator/vans/map`, gps-freshness, van_locations realtime
- **location-routing-expert** — address→route builder, geocode, shared `needsRouting`, cron TZ
- **coordinator-ops-expert** — `/coordinator` dashboard, worklists, closeout, announcements, groups, print failsafe
- **student-edit-flow-expert** — `/coordinator/students` roster + edit, filters, age groups, boarded-stop guard
- **nametag-flow-expert** — `/coordinator/nametags` + stop colors, print bands, needs-routing tag
- **notifications-expert** — Twilio SMS, Resend, crons, webhooks, STOP/opt-out
- **offline-pwa-expert** — offline outbox (`lib/offline/*`), service worker, replay safety
- **auth-session-expert** — `/login`, getSessionUser, `ALLOW_NO_LOGIN` kiosk gate, roles, middleware
- **photos-storage-expert** — `/photos` Drive embed, private buckets, signed-url (+ batch), image resize
- **design-system-expert** — `globals.css` OKLCH theme + print CSS, state-presentation/state-badge, `ui/*`, responsive
- **data-integrity-expert** — event log, record_event/smart_checkout, the view + anomalies, RLS, migrations, idempotency
- **test-suite-expert** — Vitest + pgTAP + Playwright, `pnpm check`/`test:db`, coverage strategy

## Current status (2026-05-31 — morning name tags + editable town colors)

All 5 phases on `main`. **193 unit tests pass; typecheck, lint clean.** pgTAP extended to 22 assertions but is **unverified since 2026-06-01** (Docker not running locally; run `pnpm supabase:reset && pnpm test:db` to confirm — and note `pnpm check` does NOT include pgTAP).

### 2026-06-30 — LIVE VBS WEEK (day 1): wrong-van data fix + clickable dashboards + van UX + on-site flow

Event is running (VBS_DATES 06/30–07/02). Worked live against **production** (hosted Supabase; service-role key is in `.env.local`, so throwaway `scripts/_*.ts` via `npx tsx` can inspect/patch prod). All app changes shipped straight to `main` → Vercel (`vbs26.vercel.app`); **501 unit tests / typecheck / lint / `next build` green** at each push.

**Wrong-van incident + data fix (the big one).** Kids rode the wrong van AM of day 1. Root cause: the van is set by the **pickup-region dropdown at signup** (`registerFamily` writes `regionStopId` straight to the day-record stops); the typed **home address never chooses the van**, and `autoAssignStopsFromAddresses` only fills EMPTY legs, so a wrong dropdown pick is never corrected. Diagnosed per-date (my first cross-date inspection collapsed days and over-counted): **6/30 had 44 address↔van mismatches; 7/1 & 7/2 had already been corrected to ~0** by someone editing the future days. Fixed the remaining 7/1/7/2 stragglers via a one-off script that re-derives each kid's van from their address region (`localRegionKey` regexes copied from `geo` logic), scoped to future days only (today left as-is, revert JSON saved). **7/1 & 7/2 now 0 mismatches.** Caution baked in: the "Sisseton general" bucket is unreliable for plain-Sisseton-town addresses (e.g. Tiospa Dr is really Old Agency), so bulk re-derivation is NOT safe to trust blindly.

**Durable self-service fix for the above:** `/coordinator/van-rosters` (driver sheets) now has a per-rider **"Move to van" dropdown** (screen only, hidden on print) → new `setStudentVan` server action points the legs the kid's mode rides at the chosen van's zone across the **viewed day + rest of VBS**, with the boarded-stop guard. Root cause (signup dropdown overriding address) is still open — offered to make signup derive the van from the address; NOT yet done (risk: messy/typo'd address data could silently mis-default).

**Clickable dashboards (coordinator):**
- Stat cards (Expected / On a van / At site / Checked in / Home / No-show / Needs attention) → tap to filter the roster to exactly those kids. One shared `METRIC_MATCHERS` map drives both the card count and the filter (`?show=<metric>`), so list always matches the number.
- "Kids coming by van" cards → `/coordinator/van-group/[vanId]`, now a **compact list** (shared `RosterList`: color dot, name, wristband, status, tap → `/table/[code]`). Was a heavy per-kid inline-action page; dropped `StudentActions` + guardians/pickup fetches. (The review-flagged "un-routed van kid gets a fabricated Send-home-on-van" bug is now moot here since the page has no inline actions; the `offersPmVanCheckout`/`pmVanAvailable` guard on `StudentActions` stays, default-safe. `/table` still has that latent hole — afternoon-van not threaded into `lookupByWristband`.)

**Van driver/aide screen (`/van/[vanId]`):**
- Tap a rider's **photo → phone camera** (`capture=environment`), client-resized, saved via new `setStudentPhoto` action (gated `canDriveVan`).
- Header + over-capacity banner now count **kids left to pick up** (AM riders still `not_started`, excluding no-shows / PM-only), counting down as you board.
- **Compact rows** (smaller photo/name/padding, `min-h-12` buttons) to fit more kids per phone screen.
- `Save all` button on `/coordinator/vans/manage` driver/aide editor (state lifted; writes every van's pairs at once).

**On-site registration flow:** success → **check-in modal pops** (one-tap "Check in [child]" per kid via new `checkInByCode` = lookup + `parent_dropoff`; already-present kids report `alreadyIn`) → success card also offers **Print name tag** (deep-links `/coordinator/nametags/quick?first=&last=`, which now pre-fills the name). Note `/coordinator/nametags/quick` already existed and solves the "reprint the whole sheet for one walk-in" problem (prints one tag onto a chosen Avery-5395 position, auto-advances).

**Still open:** signup address-derives-van (prevent recurrence for new signups); close the `/table` fabricated-van hole; decide today-6/30-PM reshuffle (left as-is); pgTAP still Docker-unverified.

### 2026-06-17 (cont.) — door-to-door hardening: registration is now orphan-safe (380 tests)

Three fixes so the signup link is safe to send out for on-a-phone, door-to-door use (all green: 380 tests / typecheck / lint / `next build`):
- **Network-failure feedback:** `signup-form.tsx` submit now has a `catch` → a dropped connection (or a payload the server rejects pre-handler) shows "Couldn't reach the server — tap Register again. Your info is still here." (was a dead spinner, no message).
- **Photo payload ceiling:** `next.config.mjs` `experimental.serverActions.bodySizeLimit = "4mb"` — several kids' inline base64 photos could exceed Next's 1MB default and fail the whole submit opaquely.
- **Orphan-safe registration (the real fix for the non-transactional chain, done WITHOUT a migration):** `registerFamily` now compensates — any failure after the family row exists deletes the half-written family. `src/lib/registration/cleanup.ts` (`partialFamilyDeletes`, tested) defines the FK-safe delete order (consents → students → families; the first two are ON DELETE RESTRICT, students cascades its day-records, the family cascades guardians/pickup/tokens); `cleanupPartialFamily` executes it. This eliminates the "half-created family / invisible kid / tokenless family" risk in production with zero deploy risk. The plpgsql `register_family` RPC remains the textbook ideal for a Docker session but is no longer needed to send the link safely.

### 2026-06-17 (cont.) — deep regression tests + safety-logic extraction (376 tests)

Acted on the code-review's #10/#11 (untested safety logic + duplicated rules): pulled the five safety-critical decisions out of the server actions into pure, framework-free, exhaustively-tested modules — fixing review bugs #2/#3/#4/#5 + the I3 duplicate-consent gap along the way. **376 unit tests / typecheck / lint / `next build` (25 routes) all green** (+74 tests).

New pure modules + suites:
- **`src/lib/day-record-plan.ts`** (`resolveDayRecordUpdate`) — mode↔stop consistency + boarded-leg safety in ONE tested resolver reusing `ridesMorningVan`/`ridesAfternoonVan`/`boardedStopConflict` (kills the 4 inlined copies). `updateStudentDayRecord` delegates (now also fetches `mode`). 30+ cases: boarded-but-untouched leg, same-value no-op while boarded, pm-boarded→pickup_only reject, unknown/null mode, minimal-diff updates.
- **`src/lib/events/occurred-at.ts`** (`clampOccurredAt`) — single home for the future-timestamp drop; `submitEvent` + `smartCheckOut` both call it (was copy-pasted).
- **`src/lib/registration/consent-check.ts`** (`validateConsentSet`) — version pin + exactly-the-required-kinds. **Tightened to require exactly N items → closes the duplicate-consent-row gap (audit I3).**
- **`src/lib/registration/insert-error.ts`** (`classifyStudentInsertError`) — wristband-vs-duplicate-child matched on message AND details (review #4); unattributable 23505 → duplicate_child (never an infinite retry).
- **`src/lib/parent/card-state.ts`** (`parentCardState`) — review #2 (not-attending flag never masks a LIVE checked-in/on-van state) + #5 (missing row → calm "not attending", not a false "Not arrived").

Still NOT done (need Docker): transactional `register_family` RPC (the one real registration gap — non-transactional insert chain can orphan a family on a mid-chain network blip) and a DB-level `least(occurred_at, now())` backstop.

### 2026-06-17 — register+admin deep audit (6 agents), safety fixes, teachers-per-group, dead-code sweep

**Security posture DECIDED:** `/coordinator` stays **public** (user's call for this one-time event). With `ALLOW_NO_LOGIN=true` anyone who knows the URL has full admin (all PII + release power); the login chain is broken in the flag-off path but unused, so it's left as-is. Do NOT re-flag this — it's intentional. (Suggested-but-not-done: delete the dead `/login` + `signIn` so the contradictory "secure default" doesn't mislead.)

6-agent audit of registration + admin flows. **Fixed (app-layer, verified green — 302 unit tests / typecheck / lint / `next build` 25 routes):**
- **Consent version pinned** — `registerFamily` now rejects any `textVersion !== CONSENT_VERSION` (public endpoint could otherwise record weaker v1 medical wording).
- **Duplicate-child no longer misread as a wristband collision** — a 23505 from the name/age dedup index returns a clear "already registered" message instead of burning 16 retries then aborting mid-chain into an orphan family.
- **Parent page** shows "Not attending today" instead of a false "Not arrived" for kids with `attending=false` (added `attending` to the status query).
- **Coordinator mode↔stop consistency enforced server-side** (`updateStudentDayRecord`): a mode change now clears the unused-leg stop (kills ghost-van manifests) AND refuses to switch a kid off a van they're currently boarded on (was only guarded in the form, not the action).
- **Future client timestamps dropped** in `submitEvent` + `smartCheckOut` (`occurredAt > now()` → undefined) so a fast van-tablet clock can't silence `is_pm_van_stuck`/`is_boarded_but_not_arrived` or poison the checkout anchor.

**Audit items NOT yet done (need a Docker/`pnpm test:db` session, deliberately deferred):** transactional `register_family` RPC (full atomicity — the dup-child fix covers the common orphan trigger but a mid-chain network failure can still orphan); DB-level `least(occurredAt, now())` clamp as defense-in-depth; `is_late_am` fallback for null-stop van kids (the late-arrival alarm can't fire until they're routed — **blocked on a global AM start time**, which isn't set yet; the needs-routing worklist is the interim). Under no-login the undo guards (no-show reversal, 60s window, newer-events) are all bypassed since every actor is "coordinator" — acceptable for solo-you, noted.

**Class-group builder extended** (`/coordinator/groups`): added a **Teachers / group** stepper (set 2 for two-per-class) and a **By teachers** mode (enter available teachers → makes `floor(teachers ÷ per-group)` groups). Summary shows needs/spare/⚠short. Pure `buildGroups` gained mode `"teachers"` + `teachersNeeded()` helper; +7 tests.

**Dead-code sweep (1 agent):** codebase already lean (no unused deps). Deleted: `src/app/auth/callback/route.ts` (dead magic-link callback), `src/lib/registration/transport.ts` + its `deriveTransportMode` tests (the single-checkbox signup inlines the mapping; the 4 modes still live in domain/day-records), and 7 unused type aliases from `src/types/domain.ts` (AuthorizedPickupPerson, IncidentSeverity, NotificationChannel, NotificationStatus, StudentDayRecord, VanAssignment, VanLocation). Kept (NOT dead): the SW kill-switch (`public/sw.js` + register), the whole login chain, v1/v2 consent text + retired consent-kind enum entries (historical records reference them).

### 2026-06-17 (overnight) — autonomous review loop, 8 waves on a branch

All work is on branch **`feat/vbs-safety-offline-routing-efficiency`** (pushed; latest `20bf5a6`), NOT `main` — review/merge in the morning. Green at every step: **typecheck + lint + 295 unit tests + `next build`** all pass. (pgTAP is now `plan(30)` but still **Docker-unverified** — run `pnpm supabase:start && pnpm test:db`.)

The branch first bundles the day's safety/offline/routing/efficiency work (commit `adb66bc`: migrations 0019–0023, ALLOW_NO_LOGIN gate, boarded-stop guard, offline outbox, address route builder, age groups, two-color tags, GPS freshness, query parallelization + batched signed-URLs + dead-code trims). Then 8 paced overnight waves, each one focused area, verified green, committed + pushed:
- **W1** `77206de` — students roster **Status filter** + extracted tested filter/sort core (`student-filter.ts`).
- **W2** — present-only age grouping was already built+tested (no change).
- **W3** `89e4cb7` — `canUndo` extracted to one tested source (`lib/events/undo.ts`); fixed the drifted undo test (it was missing the no_show + newer-events rules).
- **W4** `f70f774` — **multi-day routing**: `autoAssignStopsFromAddresses` now routes ALL VBS days in one click (was Day-1-only → kids fell off the van Days 2–5), idempotent.
- **W5** `8f90f09` — `/table/[code]` **no-schedule hard-stop** (was rendering actions that failed on tap when a kid had no day-record).
- **W6** `9c174e2` — pgTAP **negative-authz + restricted-release** assertions (`plan(23)→(30)`; test-only).
- **W7** `80754a8` — `buildPickupOptions` extracted to a shared tested lib (`lib/checkin/pickup-options.ts`).
- **W8** `20bf5a6` — anomaly-watch aggregation extracted to a tested lib (`lib/notifications/anomaly-watch.ts`); cron + test now share it.

Also created 3 missing flow agents: **coordinator-ops**, **notifications**, **offline-pwa** (`.claude/agents/`).

**DEFERRED (deliberately not done autonomously — need a supervised Docker/browser session):**
- **Release-has-no-Undo** (check-in): `smartCheckOut` releases show no Undo toast and `undoEvent` only supersedes one event (the PM chain is 2–3). Needs a chain-aware coordinator-reversible path on the DB release path.
- **Cold-open offline**: `public/sw.js` is a deliberate kill-switch, so the outbox only covers writes after an online load. A real caching service worker is outward-facing (persists in browsers, can brick the live app) — build + verify in a browser.

**Still open (lower priority):** run pgTAP/0019–0023 under Docker; `tests/integration/` still empty + E2E is a smoke test; address not editable post-signup (geocode only runs at the builder); the `/coordinator` device-clock-vs-server-time GPS-freshness nit; photo-without-consent gap. **Deploy note:** `ALLOW_NO_LOGIN` now defaults OFF — set it `true` on Vercel to keep kiosk mode (and gate `/coordinator/*` at the network/Vercel layer if so).

### 2026-06-16 — feature-agent team + full-app audit + new product direction

**Agent team created** in `.claude/agents/` — one specialist per flow, each with its own `.claude/agent-memory/<name>/`: `registration-flow-expert` (updated), `check-in-flow-expert`, `van-flow-expert`, `live-map-flow-expert`, `student-edit-flow-expert`, `nametag-flow-expert`, `test-suite-expert`, `data-integrity-expert`. Recommended-but-not-yet-created: a **location/routing** agent (owns address→route building), **coordinator-ops** (dashboard/anomalies/closeout), **notifications** (SMS/email/cron/webhooks).

**Deep audit findings to act on (verified against code, several contradict older notes here):**
- **Live van map is BUILT and shipped** (`/coordinator/vans/map`, nav-linked) — and it's **Leaflet + OpenStreetMap, NOT Mapbox**. `MAPBOX_TOKEN` is dead config; `geo.ts` is pure haversine ETA wired only into the parent page. The "build last / Mapbox / Directions Matrix" notes elsewhere here are stale.
- **`src/lib/pdf/` is EMPTY** — the "Sunday-night printed PDF failsafe" does not exist. Only the live browser-print name-tag sheet exists. No offline paper backup today.
- **Table volunteers can write 5 event kinds** (`parent_dropoff, site_checked_in, site_checked_out, parent_pickup, no_show` + `override` via Undo), not the "2" stated under RLS — trust `_authorize_event` (0017).
- **`smart_checkout` bypasses `record_event`** (direct inserts, not idempotent, skips per-step legality) and staff use the admin client — release safety rests on `_authorize_event` + `getSessionUser`, NOT RLS.
- **`parent_pickup` "who picked up" CHECK constraint was never created** (0017 promised it; body omits it) → a child can be released with empty pickup metadata at the DB level. **`is_restricted` ("do not release") is UI-banner-only** — no server block.
- **Non-attending kids still appear on the van roster** (`/van/[vanId]` doesn't filter `attending`); dashboard/nametags were fixed. Stat counts are inconsistent across screens.
- **Anomaly time-math uses the mutable session timezone GUC**, not a fixed zone (0013 pins it at DB level only). pgTAP is **stale/ungated** (predates `_authorize_event`; the 0018 aide-PM tests were never run).
- Live function versions: `record_event`/`_authorize_event`=0017, view=0012, `smart_checkout`=0018, state machine=0009 (functions are redefined by `create or replace`; latest wins).

**New product direction (2026-06-16 — to be built next, owned by the agents):**
- **Register rework:** collect a home **address** instead of making parents pick a stop (stop wasn't knowable without it); form is sent ahead + used door-to-door; **super easy** for non-technical families; mobile-responsive with a clear **success/confirmation**; **strip the emailed-code flow** (use the no-login token URL).
- **Location/routing:** addresses → build the best home-bound van route; students **with no address are flagged, not auto-grouped onto a van.** Stops + colors STAY (a kid can have different AM/PM stops, each colored); they're derived from addresses rather than hand-picked.
- **UI:** simplify typography + reduce text app-wide; **declutter** (the app feels bloated with wristband codes — keep them only where scanned/typed); make the **van + live-map flow simple with bigger text**; **remove the user-facing word "manifest"** (→ rider list).
- **New features:** per-day **age-based groups** of students in attendance, target size **~10**; **age filtering** in the coordinator students list; **two-color name tag** when pickup stop ≠ drop-off stop.
- **Concurrency (answered):** multiple computers/phones can check kids in simultaneously by design (per-(student,date) lock + idempotency + illegal-transition rejection + realtime); ~15–20 users cleared. Do NOT restrict to one instance. Caveats: profile edits are last-write-wins; van GPS best-effort.

**Register rework SHIPPED (verified green):** `/signup` now collects a home **address** (required when a child rides a van) + two "rides van AM/PM" checkboxes that derive the 4 modes via `deriveMode`; stop-picking removed; van kids' day-records write **NULL stops**. typecheck + lint + 194 unit tests + `next build` (24 routes) all pass. Staff OTP login untouched (the "email code" is staff auth, not family).

**Production-readiness audit verdict: NO-GO** (run 2026-06-16 across all flows). Build/tests green, but:
- **BLOCKER (regression from the rework):** van kids register with NULL stops → the view derives NULL van/color → they appear on **no van manifest**, can't be PM-dropped-off by driver/aide (null afternoon_van fails authz), print a misleading "P · Parent drop-off / No van" tag, are hidden under "Parent drop-off" on the dashboard, and **`is_late_am` can't fire for them** (no scheduled time). The address→route builder that's supposed to assign stops isn't built. Existing seeded data with stops is unaffected; fresh van registrations are broken end-to-end.
- **BLOCKER (pre-existing):** restricted "DO NOT RELEASE TO" has **zero server-side enforcement** (banner only; free-form pickup name + direct RPC both release a barred adult).
- **BLOCKER (pre-existing):** the "Sunday-night printed PDF failsafe" doesn't exist — `src/lib/pdf/` is empty; only browser-print name tags exist.
- **Operational blockers:** Vercel crons are UTC (day-before fires 14:00 CDT not 19:00; anomaly window clips early vans) — `vercel.json`; Twilio webhook URL must byte-match `NEXT_PUBLIC_BASE_URL` or STOP/opt-out 403s.
- **Should-fix:** `smart_checkout` not idempotent (retry double-inserts PM chain); `parent_pickup` "who-picked-up" CHECK never created; `/van/[vanId]` doesn't filter `attending`; consents enforced by count not kind (public endpoint); parent page needs `noindex`; day-before cron double-texts on retry.
- **Unverified:** pgTAP (needs Docker) — the DB authz tests have not been run since the authz refactor.
- **Minimal path to GO:** (1) a "Needs routing" coordinator worklist (attending kids, `mode != parent_both`, null stop) + keep manual stop-assignment (the edit screen works) — restores van visibility + the late-alert; (2) restricted-release server block; (3) Sunday-night roster + per-van manifest browser-print failsafe; (4) cron TZ + webhook URL; (5) `smart_checkout` idempotency + `parent_pickup` CHECK + van `attending` filter. Mapbox geocoding/optimizer can wait.

**Agent team:** 9 specialist agents written in `.claude/agents/` (added `location-routing-expert`) but only `registration-flow-expert` (pre-existing) loads this session — the rest need a Claude Code restart to register.

### 2026-06-16 (cont.) — audit blockers fixed

Worked the blocker list to green (typecheck + lint + **214 unit tests** + `next build` all pass; **migration 0019 + pgTAP still need a Docker run to verify** — Docker was down):
- **Routing visibility (regression fixed):** new **"Needs routing" worklist** on `/coordinator` — directional (`needsRouting` in `dashboard.ts`, tested: a parent-dropoff-only kid needs only a PM stop, etc.). Manual stop-assignment via the edit screen is the interim until geocoding lands. `/van/[vanId]` now filters `attending`; `updateTodayStops` got the mode↔stop consistency guard; van header renamed "manifest"→"riders".
- **Restricted release blocked** server-side: `smartCheckOut` rejects release to an `is_restricted` person (by id OR free-form name); `smart_checkout` (migration **0019**) backstops it at the DB and requires a non-empty pickup name; new `parent_pickup_has_name` CHECK (NOT VALID, override-exempt).
- **Paper failsafe built:** `/coordinator/print` — per-van manifests + master roster, browser-print, no PDF dep; un-routed kids flagged not dropped (`src/lib/failsafe/print-data.ts`, tested).
- **Crons:** `vercel.json` fixed to CDT (`0 0 * * *` = 7pm day-before; `*/5 11-23` ≈ 6am–7pm); day-before cron now has cross-run dedup (no double-text on retry).
- **Consents** enforced by KIND not count; **parent page** `noindex`; signup **allergies/medical un-collapsed** (safety); `deriveTransportMode` moved to a zod-free module (`/signup` stays 6 kB, not 24).
- **Verified non-issue:** `smart_checkout` is effectively idempotent — the per-(student,date) advisory lock + in-lock state re-derivation make a retry/double-tap a no-op (second call derives `home` → empty chain). No change made.
- **Still open:** pgTAP stale + unrun (Docker) — un-stale + run before go-live; Twilio webhook URL must byte-match `NEXT_PUBLIC_BASE_URL` (operational); address geocoding/optimizer unbuilt (manual assignment works meanwhile); GPS staleness still shows green; broader van/map "bigger text" UI pass still pending. Mixed AM/PM van legs ARE supported (two independent checkboxes → 4 modes).

### 2026-06-16 (cont.) — features: GPS staleness, two-color tags, age groups + filter

- **GPS staleness (safety):** the live map no longer shows a dark van as green. `gpsFreshness` (pure, tested) classifies each van fresh (<2m) / stale (<10m) / dark (≥10m); markers + the side list recolor green/amber/red and a "⚠ N vans not reporting" banner shows. `src/lib/gps-freshness.ts`, `coordinator/vans/map/van-map.tsx`.
- **Two-color name tags:** when a kid's morning stop color ≠ afternoon stop color (dropped off one place, van home from another), the tag prints a split AM|PM band with both colors; same/one color → single band. `tag-data.ts` exposes per-leg colors; `nametag-sheet.tsx` renders.
- **Age features:** coordinator **age filter** on `/coordinator/students`, and a new **`/coordinator/groups`** that splits the day's attending kids into balanced age groups (~10; `ceil` count so none exceeds target — 23→8/8/7). Pure `buildAgeGroups` (tested).
- **Shared routing rule:** `src/lib/routing.ts` (`needsRouting`, van-id based) is now the single definition used by the coordinator worklist, the paper-failsafe roster, AND the name tags — fixing the earlier divergence where a van kid with no stop slipped through one surface as "Parent drop-off". A van kid with no stop now prints a loud "⚠ Needs routing" tag band.
- **Verified:** typecheck + lint + **233 unit tests** + `next build` all pass.
- **Still pending:** address geocoding + route optimizer (needs the Mapbox token); a broader van/map "bigger text" typography pass; pgTAP + migration 0019 still need a Docker run.

### 2026-06-16 (cont.) — anomaly TZ pin, smart_checkout idempotency backstop, override pickup hole, pgTAP un-staled

Driven by a second 8-agent flow-by-flow review (van/registration/check-in/live-map/student-edit/nametag/test-suite/data-integrity/location-routing). The review confirmed 0019 + the interim unblock above are real and corrected several stale audit notes. Acted on the safety items still open:
- **Anomaly clock-math pinned (migration 0020):** the view computed `is_late_am` / `is_in_but_not_out` deadlines with `at time zone current_setting('TIMEZONE')` — a SESSION-mutable GUC a pooler can `SET`, shifting "late"/"never checked out" by hours. Now hard-coded `'America/Chicago'` in the view body so the alerts (and their SMS) are immune to session zone. Interval-based flags were never at risk. **Must match the event's local zone if the church isn't Central.**
- **smart_checkout idempotency hardened (migration 0021):** the per-(student,date) advisory lock + in-lock state re-derivation already make a double-tap a no-op under READ COMMITTED, but the random `idempotency_key` meant the unique index could never *catch* a duplicate if that assumption broke (dangerous case: two `parent_pickup` rows, different pickup names). Key is now deterministic, **anchored to the latest event over ALL rows (incl. superseded + override)** at chain-build time, with a `unique_violation`→no-op guard: an identical retry collides and dedupes; an Undo (which appends an `override` row that becomes the new latest → new anchor) lets the redo record. *(First cut anchored only over active/non-override rows, which collapsed back after an Undo and silently no-op'd the redo — caught by the van + data-integrity verification pass and fixed.)*
- **Last custody hole closed:** `parent_pickup` removed from `OVERRIDABLE` on `/table/[code]`. It was the one release path routing through `record_event` (no restricted "do-not-release" block, no who-picked-up record — the 0019 CHECK exempts override rows). Coordinators release via the normal pickup picker → `smartCheckOut`, which enforces both.
- **Routing rule made van-based + loud everywhere:** `src/lib/routing.ts` `needsRouting` is now van-id based (catches BOTH no-stop and stop-not-on-a-route) and shared by the dashboard worklist, paper roster, AND name tags. A van kid with no resolved van prints a loud red "⚠ Needs routing" tag band and shows "⚠ NEEDS ROUTING" on the paper roster instead of a calm "Parent drop-off".
- **pgTAP un-staled (still Docker-unverified):** fixtures now carry `van_assignments` + `student_day_records` + an AM/PM route + a `table_volunteer` user so the aide-authz path actually runs; assertions #5/#11 expect **42501** (authz runs before legality now), #19's `parent_pickup` carries a name for the 0019 CHECK, #20 stays a true **P0001** illegal-transition (aide authorized for the event, state machine rejects). **Run `pnpm supabase:start && pnpm test:db` to confirm — edited without a live run (Docker down).**
- **Boarded-kid stop guard (safety) — `src/lib/routing.ts` `boardedStopConflict` (tested) + `updateTodayStops`/`updateStudentDayRecord`:** a mid-day stop edit re-points the DERIVED van, and the aide's offload authz keys on that van — so changing the stop for a leg the child is currently ON (`van_boarded_am` → morning, `van_boarded_pm` → afternoon) would strip the aide holding them of check-out authority. Both coordinator write paths now reject that edit ("undo their boarding first"); pre-board call-ahead re-routes and the other leg stay allowed.
- **Verified:** typecheck + lint + **246 unit tests** + `next build` all pass. pgTAP is the only piece unverified.
- **Second verification pass (all 9 flow agents re-reviewed):** registration / check-in / live-map / nametag / test-suite all **GOOD**; data-integrity **GOOD** (confirmed 0020 byte-identical-except-TZ, 0021 correct after the anchor fix); van + student-edit **ISSUES** that are now addressed (the 0021 anchor regression + the boarded-stop guard above). test-suite ran `pnpm test` green and statically traced all 22 pgTAP assertions → none expected to fail when Docker runs.
- **Still open after this pass:** pgTAP needs the Docker run (static-traced green); the route builder is **per-day** while registration writes all VBS days, so a coordinator must run "Build from addresses" once per day (multi-day routing still the top gap — worklist/edit/builder all single-date); live-map freshness still judged against the coordinator's device clock (not server time); `/coordinator` header + roster counts still ignore the attending filter the cards apply (cosmetic mismatch); name-tag two-color + needs-routing paths lack unit tests; registration insert chain still non-transactional; photo-consent gap; address not editable post-signup (so geocode only runs at the builder).

### 2026-06-16 (cont.) — van/map bigger text + address→route builder

- **Van screens bigger + simpler:** `/van` picker and `/van/[vanId]` rider rows, action buttons, GPS toggle, and the photo-verify modal scaled up for glance-while-moving use (presentation only — no logic/flow change). The map side-panel text bump is still pending.
- **Address → route builder (the Mapbox-token feature):** `MAPBOX_TOKEN` is now set in `.env.local`. `src/lib/geocode.ts` geocodes addresses (Mapbox when the token's present, free OSM Nominatim fallback, returns null → kid flagged not dropped). `src/lib/route-build.ts` (pure, tested) assigns each un-routed van kid to the **stop nearest their home**, filling only the empty legs their mode needs (never overrides a manual stop). `autoAssignStopsFromAddresses` server action (coordinator-gated) geocodes missing families (capped 75/run) + assigns + returns `{assigned, geocoded, flagged, pending}`; a **"Build from addresses"** button sits on the dashboard's Needs-routing card.
- **Not built yet:** route-ORDER optimization (stop sequencing / TSP) and clustering addresses into *new* stops — v1 assigns to existing coordinator-defined stops. Real road ETAs (Directions Matrix) still TODO; geocoding currently powers assignment only.
- **Verified:** typecheck + lint + **241 unit tests** + `next build` all pass. (Geocoding hits a live API at runtime — not exercised in tests; the pure assignment math is.)

### 2026-06-16 (cont.) — login is now email + password (magic-link removed)

Staff sign-in dropped the magic-link / 6-digit email-code flow for plain **email + password** (`signInWithPassword` in `server-actions/auth.ts`; `login-form.tsx` is now an email+password form). Families never log in (token status URL). Set passwords out-of-band with **`pnpm set-password <email> <password>`** (admin API — no inbox, auto-confirms email; creates the auth user if missing), then `pnpm set-role <email> coordinator|admin` for the role. `auth/callback` + the root `/?code=` handler are now dead but harmless. This supersedes decision #1's magic-link tie for staff.

### 2026-06-16 (cont.) — offline outbox for the van flow (v1)

Van drivers in weak/dead-signal areas: taps no longer fail-and-lose. `src/lib/offline/outbox.ts` is a PURE, heavily-tested queue core (enqueue + dedup by key, ordered drain by capture time, ok/reject/network handling, **stop-on-offline**, and **never silently drop** — permanent rejections are marked FAILED + surfaced, not discarded). `src/lib/offline/use-outbox.ts` is the browser shell (localStorage persistence, sync on reconnect + 20s interval). `components/offline-banner.tsx` shows offline / syncing / failed-with-Retry. Wired into `/van/[vanId]`: Boarded / Dropped-off try the action and, on a thrown (offline) error, save locally with a "⏳ saved offline" row badge, then auto-replay on reconnect. Safe replays: `submitEvent` now accepts a client `idempotencyKey` (record_event dedups); smart_checkout is idempotent by state re-derivation. **258 unit tests** (17 new).
- **Still pending:** a service worker so `/van` + `/signup` COLD-OPEN with no signal (today the page must be loaded once while online — realistic flow: load at the church, then drive into dead zones). v2 = offline registration (wristband code generated/reconciled on sync). The table flow can adopt the same outbox.

### 2026-06-16 (cont.) — offline outbox audit (5 agents) + hardening

5 parallel adversarial audits of the offline flow. Pure core verdict: sound. Fixed 5 confirmed wiring bugs (all green: 258 tests / typecheck / lint / build):
- **Tap-time vs sync-time (had masked the overdue-van alarms):** offline events were stamped at sync time. Client now captures `occurredAt` at tap → threaded through `submitEvent` → `record_event` `p_occurred_at`, and a new `p_occurred_at` on `smart_checkout` (migration **0022**). `is_boarded_but_not_arrived` / `is_pm_van_stuck` now measure from the real time.
- **Write-back clobber:** an action enqueued *during* an in-flight sync was silently lost; `use-outbox` now reconciles the drain result against the LIVE queue ref instead of overwriting from the pre-await snapshot.
- **`crypto.randomUUID` fallback** (`src/lib/offline/uuid.ts`) — a non-secure/old webview can't lose a tap.
- **Honest persistence:** a failed localStorage write (Safari private / quota) now warns ("write it on paper") instead of a false "saved"; `load()` guards corrupt/non-array data.
- **Failed-per-kid:** a failed sync shows a red "⚠ didn't save" marker on that kid's row (was a global count only).
- Confirmed already-safe: smart_checkout double-release (0021 deterministic key handles retries). **Deferred:** service worker (cold-open offline), "roster as of HH:MM" staleness note, cancel-a-queued-action, GPS-offline toast suppression. 0022 still needs a Docker run to verify.

### 2026-06-16 (cont.) — no-login is now an explicit opt-in (`ALLOW_NO_LOGIN`)

A 2nd full 9-agent verification pass (offline-focused) found two items: the `occurred_at` thread (already fixed above + 0022) and that **no-login shipped unconditionally** — `getSessionUser` granted coordinator authority to ANY unauthenticated request, with no env guard and middleware gating nothing. That's safe for a closed kiosk but a hole if the deploy is reachable from the public internet.
- **Gated behind `ALLOW_NO_LOGIN`** (`src/lib/env.ts`, `src/lib/auth/session.ts`): OFF by default → an unauthenticated request now returns `null` (→ login). Set `ALLOW_NO_LOGIN=true` per-environment to keep kiosk mode. **ACTION:** add `ALLOW_NO_LOGIN=true` to `.env.local` (dev) and to Vercel env (prod) to preserve current no-login behavior — without it, staff must sign in (email+password). A no-login deploy MUST also be access-restricted (Vercel Deployment Protection / trusted network), since the in-app role check no longer gates anything once it's on. Documented in `.env.example`. Real identity + role still win when someone IS signed in, flag or not.
- **pgTAP #23 added** — locks the `record_event` `p_occurred_at` contract the offline replay depends on (records real tap time, not sync time). Suite now `plan(23)`; still needs a Docker run.
- **Verdicts:** all 9 flows GOOD/green after the offline landing except the two items above (both now closed). 260 unit tests / typecheck / lint / `next build` all pass. Idempotent replay, never-silently-drop, FIFO order, GPS-not-queued, and the B1 boarded-stop guard all re-confirmed by the agents.

### 2026-06-16 (cont.) — offline deferred items shipped

The 4 deferred offline items are built (260 tests / typecheck / lint / clean build):
- **Service worker (cold-open offline):** `public/sw.js` + `ServiceWorkerRegister` (prod-only). Network-first for navigations (caches the last `/van` HTML so a cold open in a dead zone still shows the last roster), cache-first for hashed `/_next/static`, network-only for writes/RSC (the outbox remains the source of truth). **Needs a real device/PWA test before relying on it.**
- **Roster staleness note:** the offline banner shows "Roster shown is from HH:MM — may be out of date" (van page passes `loadedAt`).
- **Cancel a queued action:** `removePendingForStudent` (tested) + `cancelForStudent` on the hook + a per-row "cancel" link when a kid is queued offline — a wrong offline tap is recoverable before it syncs.
- **Quiet GPS offline:** the broadcast handler no longer toasts every 15s offline; shows one calm "Location not updating (offline)" status in the GPS card + added the missing `.catch`.

### 2026-06-16 (cont.) — class-group builder (check-in-aware + controls)

`/coordinator/groups` is now an interactive builder, not a static list:
- Groups from **checked-in kids** by default (`state = site_checked_in`) with an **"All expected"** toggle to pre-plan; previously it grouped all attending.
- Live controls (client `groups-builder.tsx`): **kids-per-group OR number-of-groups (= teachers, one each)**, **similar-vs-mixed ages**, a summary (N kids → G groups · ~K each · G teachers), and **Print**.
- Pure `buildGroups(kids, {mode,targetSize,groupCount,mix})` in `lib/coordinator/groups.ts` — count-mode clamps to #kids, mix = round-robin age spread, size-mode = balanced age clusters; tested. `buildAgeGroups` kept as a thin wrapper.
- Not persisted yet (generate + print; no saved class/teacher assignments) — natural follow-up.

### 2026-06-13 — live on Vercel + registration simplification

**Production is deployed on Vercel** (`vbs26.vercel.app`) against a hosted Supabase project. Auth emails send via **Resend SMTP** (custom domain `mail.k2e.app`, verified; sender `vbs@mail.k2e.app`). Env wired on Vercel: Supabase URL/anon/**service_role** (the service key was initially wrong → `public.users` rows never auto-created, which silently breaks registration + sign-in profile creation; verify it decodes to `role: service_role`), `NEXT_PUBLIC_BASE_URL`, Resend, Mapbox (staged, unused). Admin access = sign in, then `update public.users set role='admin' where email=…` (no in-app role UI). Mapbox token is staged but the **address-first stop planner is still unbuilt** (the discussed feature: geocode addresses → cluster-suggest stops → coordinator finalizes on a map).

**Registration form simplified** (no DB migration — name splits into the existing first/last columns on save):
- Single **"Child's name"** field replaces legal first/last/preferred. `splitName()` in `registration/schema.ts` (last word → last name) maps it to `legal_first_name`/`legal_last_name`; everything downstream reads those columns unchanged.
- **Age** box added next to DOB; either one satisfies the dob-or-age guard (client + server).
- **Three consents** now (`CONSENT_VERSION = "v3"`): media_release, general_liability, and medical (reworded as guardian-emergency-availability + first-aid authorization). Dropped transport + photo_release from the active set; v1/v2 retained for already-signed records. **Open gap: photo still required but no consent covers wristband-photo use.**
- Removed the "type your full legal name to sign" field; consent records auto-attribute `typed_name` to the primary guardian (+ IP/UA/timestamp).
- **Coordinator student-edit** screen aligned to the same single-**Name** field (was editing an orphaned "preferred first name"); `updateStudent` splits the name and clears any stale preferred override.

**Door-to-door simplification** (for on-the-spot phone signup): photo, email, address, and emergency contact are all **optional** now; phone stays required (it's the safety contact). Email/address/emergency tuck into a collapsible "optional details" `<details>` so the default form is name + phone + child name + age + transport + consents. No migration — `primary_email` is NOT NULL so a blank stores `""`; the rest were already nullable. `OptionalEmailSchema` accepts a valid email, blank, or omitted. Table check-in contact block now guards the email `mailto:` so a blank email doesn't render a dangling link.

**Coordinator dashboard rebuilt** (`/coordinator`): big at-a-glance stat cards (expected / on a van now / at site now / checked in today / home / no-shows / needs attention) + a per-town rollup ("kids coming by town" with color dot, expected count, in/home). Pure counting in `src/lib/coordinator/dashboard.ts` (`computeMetrics`, `computeTownBreakdown`), unit-tested; cards in `dashboard-cards.tsx`. Dashboard counts filter to **attending** kids (the old tiny state-count grid did not). Town comes from the morning stop (fallback afternoon); stop-less kids group under "Parent drop-off".

### 2026-06-01 — full-repo gap audit (68 agents) + CRITICAL check-out fix

Ran an 8-dimension cross-verified audit: **43 findings → 39 confirmed (8 core / 14 important / 17 optional), 4 refuted** (incl. the now-fixed "stop on two vans" — the verifier saw the guard and dropped it). Full roadmap lives in the audit task output; top items below.

**FIXED — critical (migration 0018):** `smart_checkout` authorized the whole PM chain against `site_checked_out`, which `_authorize_event` forbids for driver/aide — so **drivers/aides could never record the PM van drop-off** ("Dropped off" → 42501 every time). The core get-kids-home flow was coordinator-only. 0018 authorizes the chain by KIND (van-PM chain → `van_offloaded_pm` w/ assigned-van check; parent chain → `parent_pickup`), inside the lock. Added pgTAP (21–22) for the aide path. **Needs `pnpm test:db` to verify (Docker was down).**

**Top open items (not yet fixed):**
- CORE: pgTAP suite is stale + ungated (predates `_authorize_event`; fixtures lack van_assignments/day_records); no server-side block when releasing a child to an `is_restricted` pickup person (banner only); documented parent_pickup "who picked up" CHECK constraint was never created; non-attending kids still appear on van manifests + dashboard counts; anomaly time math uses mutable session timezone GUC not a fixed zone; mid-day stop change can strand a boarded kid / break the aide's authz.
- IMPORTANT: registration is a non-transactional insert chain (no rollback); day-before reminder cron has no cross-run dedup (double-texts on retry); van GPS staleness never alerts (green forever); parent token page has no `noindex`; no per-van accounted-for rollup; no offline outbox; runbook lacks "missing kid"/"van dark" procedures; `tests/integration` is empty.
- OPTIONAL (17): incident-read UI, parent self-service edit, add-child-to-family, signup capacity enforcement, multi-day attendance view, roster export/print, field escalation, `/photos` staff-gating, Google-Drive photo link exposure, etc.

### What changed in the 2026-05-31 name-tags + color-editor pass

Two coordinator features the user requested ("print a name tag for each student each morning, show town colors on the stickers; are colors customizable?").

**Name tags (`/coordinator/nametags`):**
- Server component (`src/app/coordinator/nametags/page.tsx`) mirrors the coordinator/today fetch pattern: `student_day_status` for the date filtered `attending = true` → `students` → `stops` → `vans`. Defaults to today; `?date=`/`?town=`/`?van=` filters (town/van filtered server-side so the printed sheet matches the on-screen selection).
- Prints via the browser (`window.print()` + `@media print` in `globals.css`) — **no PDF library, no new deps**. Plain-paper cut grid, 2-up, dashed cut lines, `break-inside: avoid` per card, `print-color-adjust: exact` so the town color band actually prints. AppShell header is `print:hidden`.
- Each card: town **color band** (hex + color name + town, using the view's `wristband_color_for_day`), big display name, morning van name, wristband code. **No allergy/medical on the tag** (privacy — those columns aren't even selected). Parent-both kids (no stop/color) → neutral "P · Parent drop-off" band, sorted last.
- Pure, unit-tested helpers in `src/lib/nametags/tag-data.ts`: `displayName`, `buildTagData`, `sortTags` (group by color then name), `contrastText` (black/white band text by luminance).

**Editable town colors — answer to "are colors customizable?": they weren't, now they are (`/coordinator/stops`):**
- Previously colors were seed-only (`scripts/seed-dev.ts`), no UI. Now a coordinator screen edits each stop's `color_code` (native `<input type="color">`) + `color_name`.
- `updateStopColor` server action (`src/server-actions/stops.ts`): coordinator-role guard + zod (`isValidHexColor` in `src/lib/validators.ts`) → `stops` UPDATE via the cookie-bound client → `revalidatePath` for `/coordinator`, `/table`, `/van` (layout scope).
- **No migration needed**: the existing `stops_coord_write` (`for all using (_is_coordinator())`) policy in `0006` already authorizes coordinator UPDATEs (the originally-planned `0021` migration was redundant and referenced a non-existent helper — dropped). Colors fan out everywhere automatically via the `student_day_status` view, so an edit live-updates wristband swatches, the van map, the parent page, and the name tags.

**Nav:** added "Name Tags" + "Colors" to the coordinator branch of `linksFor()` in `app-shell.tsx`.

**Van management (`/coordinator/vans/manage`) — create vans, define routes, assign driver/aide:**
- Previously vans/routes/`van_assignments` were seed/Studio-only. Now a coordinator screen does all three. Reachable via a new "Vans" nav item → dashboard → "Manage" link.
- `src/server-actions/vans.ts`: `createVan`, `updateVan`, `setVanRoutes`, `setVanAssignment` — coordinator-gated, cookie-bound client (RLS `*_coord_write` `for all` policies already authorize; no migration).
- Routes are a per-van morning/afternoon **stop checklist** (order isn't consumed anywhere, so no reorder UI). A child rides the van whose route includes their stop — **derived**, never stored.
- Pure helpers in `src/lib/vans.ts` (unit-tested): `orderStopIds`, `sameDriverAndAide`, `routeStopConflicts`.

**Van-management cross-audit fixes (19-agent review → 11 confirmed, 4 rejected; fixed the real ones):**
- **Double-assignment guard**: `setVanRoutes` rejects saving a stop that's already on another van's route in the same direction (the status view's unnest-join would otherwise put a kid on two vans). Names the conflicting stop+van. Pure `routeStopConflicts` helper, unit-tested.
- **Atomic route save**: AM+PM are now one two-row upsert (`setVanRoutes`), replacing two sequential `setVanRoute` calls that could half-commit.
- **Assignment date desync**: `AssignRow` is keyed `${date}:${vanId}` so it remounts on date change — no more stale prior-day driver/aide silently overwriting another day.
- **Deactivation guard**: `updateVan` blocks setting a van inactive while it still has non-empty routes ("Clear this van's routes first").
- Deferred (low/nit, noted): same-person-on-multiple-vans warning; capacity client/zod message duplication.

### What changed in the 2026-05-27 security + audit pass

Driven by a 6-agent deep audit (state machine, unused code, efficiency/scalability, parent UX, staff UX, security/RLS).

**Security fixes (migration 0012):**
- `record_event()` and `smart_checkout()` now verify `p_actor_role` against the actual role in `public.users` — previously an attacker could call the RPC directly with `p_actor_role='coordinator'` to bypass authorization.
- `is_late_am` anomaly filter corrected back to `('van', 'parent_pickup_only')` — migration 0011 accidentally reversed it to `parent_dropoff_only`, meaning kids expected on the AM van who didn't show up wouldn't trigger the late alert.

**Webhook signature verification:**
- Twilio inbound SMS (`/api/twilio/inbound`) now validates `X-Twilio-Signature` via HMAC-SHA1.
- Twilio delivery status (`/api/twilio/status`) — same verification.
- Resend email webhook (`/api/resend/webhook`) now validates `svix-signature` header.
- All three fail with 403 when signatures don't match (no-op in dev when tokens aren't configured).

**Other security fixes:**
- `searchStudentsByName` now checks `isStaff(session.role)` — previously any signed-in parent could search all student names/wristband codes.
- `searchStudentsByName` sanitizes PostgREST filter special characters from user input to prevent filter injection.
- Auth callback validates `next` param to prevent open redirect (`//evil.com` no longer bypasses base URL).
- New env vars: `RESEND_WEBHOOK_SECRET`, `COORDINATOR_NAME`, `COORDINATOR_PHONE`.

**Staff UX:**
- No-show button now requires two taps (confirm gate) — prevents accidental terminal-state marking.
- Terminal-state message says "Ask a coordinator to fix this" for non-coordinator roles (previously said "Use override below" which they can't see).

**Parent page enrichment:**
- Shows van name during transit states ("Van: Blue Van").
- Shows pickup/dropoff stop names and scheduled times.
- Coordinator contact: tappable phone link in the footer when `COORDINATOR_PHONE` is set.

**Efficiency:**
- `broadcastAnnouncement` and day-before cron now send SMS in parallel batches of 15 (previously sequential, risking Vercel timeout at 100 families).
- Day-before cron deduplicates by family (two siblings = one SMS, not two).
- `broadcastVanLocation` no longer calls `revalidatePath("/coordinator")` on every GPS report (~60×/min was wasted work; the van map has its own realtime subscription).

**Dead code removed:**
- Deleted 3 dead files: `coordinator/realtime.tsx` (superseded by `RealtimeRefresher`), `ui/form.tsx` (167 lines, never imported), `wristband/generate-unique.ts` (never imported).
- Removed 3 unused npm deps: `@hookform/resolvers`, `react-hook-form`, `radix-ui`.

### What changed in the 2026-05-21 revamp

Driven by a 4-agent deep audit (UX/mobile, realtime/concurrency, color/state visualization, per-route state correctness).

**State-correctness fixes (the user's "states are messed up" complaint):**
- `/table/[code]` student-actions: button visibility now derives from `isLegalTransition()` directly — no more "Check in" button on `not_started` (which the state machine rejects).
- Added a first-class "Mark no-show" button for table volunteers from `not_started` (spec line 103: volunteer marks AM, coordinator reverses).
- `submitEvent` server action now rejects override events with an empty/whitespace reason before they hit the DB (DB still enforces it; this is a UX upgrade).
- `tests/unit/student-actions-surface.test.ts` pins the contract so the bug can't recur.

**Single source of truth for visual presentation:**
- `src/lib/state-presentation.ts` — every state, anomaly, medical/allergy callout has one entry: `{ label, description, icon, tone }`. Every screen reads from here. Killing the per-page `STATE_BADGE_VARIANT` / `STATE_STRIPE` maps removes the prior divergence (e.g., `van_boarded_pm` showed amber on `/coordinator` and blue on `/coordinator/students`).
- `src/components/state-badge.tsx` — `StateBadge`, `StateDot`, `AnomalyBadge`, `SafetyCallout`, `SafetyPills`. All screens use these now.
- Each of the 3 critical anomalies now has a **distinct icon** (bus / triangle / activity) so coordinators can tell them apart at a glance instead of seeing three identical red blobs.
- `tests/unit/state-presentation.test.ts` enforces full coverage + that the 3 criticals stay visually distinct.

**Theme — warm ops dashboard:**
- `globals.css` rewritten with semantic OKLCH palette: warm cream (`#FAF7F2`) background, deep teal primary (`#0F766E`), saturated semantic state tokens (`--state-pending/transit/arrived/safe/leaving/home/danger`), separate `--anomaly-warn/critical` and `--medical/allergy` tokens. Light + dark mode both tuned. CSS vars exposed through `@theme inline` so Tailwind `bg-[var(--state-safe)]/12` etc. work.
- Body uses `env(safe-area-inset-*)` padding for iPhone notch/home-indicator; `-webkit-text-size-adjust: 100%` blocks landscape font auto-scaling.
- Medical now renders with a **rose container + heart icon** (loud); allergy renders with **amber container + cross icon**. Both have full text in the callout and inline pills in dense rows.

**Mobile / iOS / Android baseline:**
- Root `layout.tsx` now exports a `Viewport` with `width=device-width, viewport-fit=cover`, app theme colors, web app manifest, apple-web-app metadata.
- `public/manifest.webmanifest` + `public/icon.svg` shipped.
- All form primitives use `text-base` on mobile (≥16px so iOS Safari doesn't auto-zoom), `md:text-sm` on desktop: `Input`, `Textarea`, `Select`.
- All button sizes have `min-h-11` (44px) on mobile, shrinking on `md:`. Same for hamburger nav trigger and inline icon buttons.
- `DialogContent` now scrolls (`max-h-[calc(100dvh-4rem)] overflow-y-auto`) so long forms don't get clipped on phones.
- Mobile nav drawer has `max-h-[calc(100dvh-3.5rem)] overflow-y-auto`; links are `min-h-12` for thumb-friendly tapping.

**Wristband color rendering:**
- `lookupByWristband` and the van/parent/coordinator queries now select `wristband_color_for_day` (hex) alongside the name. Color swatches render everywhere a kid is shown (table detail, van manifest, coordinator roster, parent page) — not just the coordinator view.

### Multi-user concurrency audit verdict

`record_event` advisory locking, idempotency, RLS, realtime debounce, and `revalidatePath` are all sound for 15–20 concurrent users (full audit report logged in the audit conversation). Two minor gaps surfaced and fixed:
- Override reason now validated client + server before DB.
- Parent token still relies on the FK column + admin client; no change needed but flagged.
The `smart_checkout` SQL function still does direct event inserts inside an advisory lock instead of routing through `record_event` — safe today (the chain is pre-validated), worth refactoring if `record_event` gains business logic.

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
1b. `supabase/migrations/0012_security_hardening.sql` — role verification fix on `record_event` + `smart_checkout`, `is_late_am` anomaly filter correction.
2. `supabase/migrations/0006_rls_policies.sql` — all the access scoping in one place.
3. `src/lib/events/state-machine.ts` — TS mirror; keep in sync with 0004.
4. `src/lib/state-presentation.ts` — single source of truth for state/anomaly/medical/allergy visuals. Add a new state? You add it here too or screens stop matching.
5. `src/components/state-badge.tsx` — `StateBadge`, `AnomalyBadge`, `SafetyCallout`, `SafetyPills`. Use these instead of building one-off badges.
6. `src/app/globals.css` — semantic OKLCH palette + state/anomaly/medical tokens. Restyling a state = change one variable here.
7. `src/server-actions/events.ts` — only client-facing event writer.
8. `src/app/coordinator/page.tsx` — the operational center of the UI.
