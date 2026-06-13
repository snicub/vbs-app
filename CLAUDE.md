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

## Current status (2026-05-31 — morning name tags + editable town colors)

All 5 phases on `main`. **179 unit tests pass; typecheck, lint clean.** pgTAP extended to 22 assertions but is **unverified since 2026-06-01** (Docker not running locally; run `pnpm supabase:reset && pnpm test:db` to confirm — and note `pnpm check` does NOT include pgTAP).

### 2026-06-13 — live on Vercel + registration simplification

**Production is deployed on Vercel** (`vbs26.vercel.app`) against a hosted Supabase project. Auth emails send via **Resend SMTP** (custom domain `mail.k2e.app`, verified; sender `vbs@mail.k2e.app`). Env wired on Vercel: Supabase URL/anon/**service_role** (the service key was initially wrong → `public.users` rows never auto-created, which silently breaks registration + sign-in profile creation; verify it decodes to `role: service_role`), `NEXT_PUBLIC_BASE_URL`, Resend, Mapbox (staged, unused). Admin access = sign in, then `update public.users set role='admin' where email=…` (no in-app role UI). Mapbox token is staged but the **address-first stop planner is still unbuilt** (the discussed feature: geocode addresses → cluster-suggest stops → coordinator finalizes on a map).

**Registration form simplified** (no DB migration — name splits into the existing first/last columns on save):
- Single **"Child's name"** field replaces legal first/last/preferred. `splitName()` in `registration/schema.ts` (last word → last name) maps it to `legal_first_name`/`legal_last_name`; everything downstream reads those columns unchanged.
- **Age** box added next to DOB; either one satisfies the dob-or-age guard (client + server).
- **Three consents** now (`CONSENT_VERSION = "v3"`): media_release, general_liability, and medical (reworded as guardian-emergency-availability + first-aid authorization). Dropped transport + photo_release from the active set; v1/v2 retained for already-signed records. **Open gap: photo still required but no consent covers wristband-photo use.**
- Removed the "type your full legal name to sign" field; consent records auto-attribute `typed_name` to the primary guardian (+ IP/UA/timestamp).
- **Coordinator student-edit** screen aligned to the same single-**Name** field (was editing an orphaned "preferred first name"); `updateStudent` splits the name and clears any stale preferred override.

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
