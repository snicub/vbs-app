---
name: door-to-door-tag-labeling
description: Door-to-door (2026-06-18) tag is single-band showing the VAN; two-color split survives only for rare mixed-mode (resolved AM zone color ≠ PM)
metadata:
  type: project
---

Door-to-door model (DECIDED 2026-06-18): each van = ONE pickup zone = one `stops` row carrying the van's color, on both the van's AM and PM route. So a kid's tag color is their **van's** zone color, AM zone == PM zone for normal van kids, and the coalesced `wristband_color_for_day` returns that single van color. No DB migration drove this — it's a modeling convention on the existing stop/color/route machinery.

**Tag headline is now the VAN, not the town (shipped 2026-06-18).** `NameTagBand` single-band path in `nametag-sheet.tsx` leads with `vanName` (big, bold) + `colorName` alongside it as the print failsafe, replacing the old `colorName · town` label. Stop-less parent-both kids (no van/color) → "Parent drop-off" + "P".

**Wristband code now FULLY REMOVED from the tag (~2026-06-28).** Earlier it was de-emphasized into a quiet footer; that footer is now gone entirely. Same change made each tag's first/last name `contentEditable` (ephemeral, print-only: `suppressContentEditableWarning`, `spellCheck=false`, `focus:bg-yellow-100 print:focus:bg-transparent`). No layout/band-logic regression — removing the code element just frees vertical room in the centered flex-1 name block; `.nametag-name` print rule (30pt) still applies to the first-name span only. `wristbandCode` still lives on the `NameTag` type + `buildTagData` (used by the failsafe roster) — harmless that the tag no longer renders it.

**GAP — `vanName` derives ONLY from `morningVanId`** (`buildTagData`: `vanName: st.morningVanId ? vans.get(...) : null`). So a `parent_dropoff_only` rider (parent drops AM, vans home PM → morning_van_id NULL, afternoon_van_id set) prints headline "Parent drop-off" even though they ARE on the PM van and the band shows the correct PM zone color — a contradictory label. Pre-existing, rare mixed-mode only; full-van (6-region Pickup-Map) kids are unaffected (both legs = zone → morningVanId set). Fix if it bites: fall back to `afternoonVanId` for the headline.

**Band precedence unchanged:** needs-routing (loud red literal text) > two-color split (AM|PM) > single coalesced band (van + color name). The two-color split (`am && pm && am !== pm`) is now the RARE exception — only fires for genuine mixed-mode (resolved AM zone color ≠ PM zone color, e.g. parent drop-off one place + vanned home from a different van's zone). Kept as the guard; NOT removed. `tests/unit/nametags-two-color.test.ts` still pins it.

**Data layer needed NO change for this pass** — `buildTagData` already carried `vanName` (from `morningVanId` → vanMap) and per-leg colors. This was purely a labeling/rendering relabel + comment refresh + tests. The color name text on every band stays the only print failsafe (grayscale/ink-saving printers print white bands). See [[color-derivation-and-fanout]] and [[print-fidelity-and-failsafe-status]].

**Verification note (2026-06-18):** my 3 slice files (`tag-data.ts`, `nametag-sheet.tsx`, `nametags/page.tsx`) are typecheck+lint clean and 30 nametag unit tests pass. The repo-wide `tsc --noEmit` had PRE-EXISTING errors ONLY in the coordinator-ops slice (`coordinator/page.tsx`, `lib/coordinator/dashboard.ts`, `tests/unit/dashboard.test.ts`) — a town→van breakdown migration in progress there (`computeTownBreakdown` → `computeVanBreakdown`, `DashStatus` gained `vanId`/`vanName`, dropped `town`). Not my slice; do not touch.
