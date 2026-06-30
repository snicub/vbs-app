---
name: presentation-contract
description: How the single-source state/anomaly presentation map is wired, its guards, and the known test-coverage holes in the single-source contract
metadata:
  type: project
---

The single-source visual contract lives in `src/lib/state-presentation.ts`: `STATE_PRESENTATION` (per `DayState`), `ANOMALY_PRESENTATION` (per `AnomalyKind`), `MEDICAL_PRESENTATION`/`ALLERGY_PRESENTATION`, plus `TONE_CLASSES`/`ANOMALY_TONE_CLASSES` mapping tones → Tailwind classes against OKLCH CSS vars in `globals.css`. Badges in `state-badge.tsx` index these maps **directly** (`STATE_PRESENTATION[state].tone`) with no internal guard — a missing key throws at render.

`safeDayState(raw)` (same file) is the only guard between a raw DB/view state string and `StateBadge`; it falls back to `not_started`. Callers must run it before passing a view string to a badge.

**Why this matters:** a missing presentation entry = a screen crash or blank badge; a stray/extra key or a tone with no class = silent visual divergence between screens (the exact bug the single-source map was created to kill — `van_boarded_pm` once showed amber on one screen, blue on another).

**Known test-coverage holes (as of 2026-06-17, branch feat/vbs-safety-offline-routing-efficiency)** in `tests/unit/state-presentation.test.ts`:
- No exact key-set equality (`Object.keys(...) === STATES`) — extra/stale keys pass silently.
- `ANOMALY_KINDS` is hand-copied into the test, not derived from `src/lib/anomaly.ts` (where `AnomalyKind` is a bare TS union with no runtime array) — a new anomaly won't fail coverage. Fix = export a runtime `ANOMALY_KINDS` const from anomaly.ts and derive the type from it.
- `safeDayState` has zero tests.
- tone-distinctness only pins 2 pairs; the 4 active-care tones (transit/arrived/safe/leaving) aren't asserted all-distinct.

**How to apply:** when adding/changing a state or anomaly, edit `state-presentation.ts` (+ a token in `globals.css`) and keep these tests green; if I touch the test file, close the key-set/`safeDayState` holes at the same time. `contrastText` (luminance → black/white tag text) lives in `src/lib/nametags/tag-data.ts` and is owned/tested by nametag-flow-expert, not here — I own the print CSS that consumes it.
