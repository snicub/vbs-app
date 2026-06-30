---
name: address-routing-and-null-stops
description: Post-rework registration collects address (not stop) + optional pickup-region pick; van kids get NULL stops unless a region is chosen, plus the downstream view-NULL cascade
metadata:
  type: project
---

As of the 2026-06-16 register rework (verified in code 2026-06-18), registration **no longer collects a stop**. It collects a home address (`street_address`/`city`/`state`/`postal_code` on `families`, all nullable text from `0002`), required client+server **only when a child rides a van**.

- Transport in the form = a **single "rides van" checkbox per child** (`ridesVan`). The form inlines the mapping: `transport: { mode: s.ridesVan ? "van" : "parent_both", regionStopId: ... }` (`signup-form.tsx:142-145`). **There is NO two-checkbox vanAm/vanPm UI and NO `deriveMode`/`deriveTransportMode` helper** — `src/lib/registration/transport.ts` was deleted (dead-code sweep). The 4 modes still exist in the enum/domain (`parent_dropoff_only`/`parent_pickup_only` are reachable via the coordinator edit screen + historical data), but signup only ever emits `van` or `parent_both`.
- **Optional "Pickup region" pick at signup (added ~2026-06-30):** a family-level dropdown of active van zones (homepage fetches them via `zoneStopIdForVan` in `page.tsx:26-36`; each van's zone = the first stop on its route). `StudentTransportSchema` gained `regionStopId: z.string().uuid().nullable().optional()` (`schema.ts:56`). The form applies the one selected `regionStopId` to **every van-riding kid** (guarded `s.ridesVan && regionStopId ? regionStopId : null` — the empty-string "figure it out" default never reaches the uuid schema). `registerFamily` maps region→stops by mode (`registration.ts:206-208`): `van`→both legs, `parent_dropoff_only`→PM only, `parent_pickup_only`→AM only. **So a van kid who picks a region is NOT null-stop — they go straight onto that van's zone both legs** (the zone stop is on the route, so the view derives the van + color). No region picked → stops stay null (below).
- When no region is picked, `registerFamily` writes `student_day_records` with **`morning_stop_id = null`, `afternoon_stop_id = null`** (van kids included). Van kids are "not yet assigned to a van"; the coordinator resolves this via address→van assignment.
- Address-requires-van guard: `FamilyRegistrationSchema.superRefine` (`schema.ts:133-147`) requires street + city when any child's mode != `parent_both`. **State is hard-set to "SD" on the client (Sisseton, SD event); ZIP is not collected.** Client mirrors the guard in `onSubmit` (`signup-form.tsx:104-107`).

**Null-stops downstream cascade (the `student_day_status` view in `0005` derives van/color/time FROM stop ids via LEFT JOINs — null stop = null everything, NOT a crash):**
- `morning_van_id`/`afternoon_van_id` → NULL (route join is on stop_id)
- `wristband_color_for_day`/`wristband_color_name` → NULL (UI shows neutral/"P")
- `scheduled_am_time`/`scheduled_pm_time` → NULL
- **`is_late_am` anomaly can never fire** while stops are null — it's guarded by `s_am.scheduled_am_time is not null` (view line 88). So until the route builder runs, a van kid who no-shows in the AM triggers **no late alert**. Safety-relevant but downstream of registration; the view/route-builder owns the fix, not `registerFamily`.

Parent page (`/parent/[familyToken]`) handles all these NULLs gracefully — every van/stop/color/time render is null-guarded; no crash on a fresh van-kid registration. A just-registered van family's page simply shows "not started", no van, no color, no pickup/dropoff lines.

**How to apply:** the null-stops state is intended/transitional. Don't "fix" it in `registerFamily` by inventing a stop. The real follow-on is the address→route builder. See [[registerfamily-insert-chain]], [[parent-token-page]].

**Per-van-zone model (current direction, 2026-06-18):** the routing owner reworked stops into per-van pickup ZONES — each van = one pickup zone carrying that van's color; vans drive door-to-door to each home, no shared corner stops. A kid's tag color is effectively per-van. This is all DOWNSTREAM of registration; registration's contract is unchanged (collect address, write NULL stops). The route builder owns address→nearest-van-zone assignment.

**Route builder EXISTS — the remedy path is real.** `src/server-actions/routing.ts` `autoAssignStopsFromAddresses` (coordinator-gated) geocodes families (`src/lib/geocode.ts`, Mapbox→Nominatim fallback, writes `families.lat/lng`) then fills only empty van legs via pure assignment in `src/lib/route-build.ts` (unit-tested). Shared `needsRouting` lives in `src/lib/routing.ts`, feeding the coordinator worklist + paper roster + name tags. (Note: `src/lib/registration/transport.ts` / `deriveTransportMode` referenced in older notes is GONE — the single-checkbox form inlines the mapping.)
- **Builder now routes the WHOLE event in one click (W4, commit f70f774, verified 2026-06-17).** Was `eq("event_date", date)` (one day per click — the prior footgun). Now `in("event_date", [...VBS_DATES])`: geocodes each family once (addresses are day-invariant; lat/lng cached on `families`), then assigns stops per (student, day). `assigned` counts day-slots filled; `flagged` is now DISTINCT no-address kids (deduped across days). Compose with registration is clean: registration writes NULL stops for all 5 days → one builder run fills every day's van legs.
- Non-destructive: only fills empty legs (`!current.morningStopId`), never overrides a coordinator's manual stop → re-runs are idempotent. No-address / geocode-fail kids are added to `flaggedStudents`, never auto-vanned (no stranded kid).
- Geocode cap `GEOCODE_CAP=75` per run; remainder reported as `pending` and a second click finishes it. For ~100 kids / dedup-by-family this is one click in practice.
