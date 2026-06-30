---
name: print-fidelity-and-failsafe-status
description: Print color-fidelity gotchas for name tags, the color-name failsafe, and the CORRECTED status of the browser-print paper failsafe
metadata:
  type: project
---

**CORRECTION to CLAUDE.md "src/lib/pdf/ is EMPTY / no paper failsafe exists":** as of 2026-06-16 a browser-print failsafe DOES exist in the working tree — `/coordinator/print` (page + `print-failsafe.tsx`) backed by `src/lib/failsafe/print-data.ts` (`buildVanManifests`, `buildRoster`). It's nav-linked ("Print / Failsafe" in app-shell.tsx), browser-print (`window.print()` + `@media print` `.failsafe-page`/`.failsafe-swatch` rules in globals.css), and adds **no PDF dependency** (package.json has no jspdf/pdfkit/react-pdf/etc). BUT it is **untracked / uncommitted** (`?? src/app/coordinator/print/`, `?? src/lib/failsafe/`) — so it's not yet "shipped" and could be lost. `src/lib/pdf/` is still literally empty; the failsafe lives under `src/lib/failsafe/` instead. Note: the failsafe roster/manifest DOES include allergies/medical (correct for staff paper backup) — that privacy carve-out (omit allergy/medical) applies to **name tags only**, not the failsafe sheet.

**Print color fidelity (name tags):** band color = inline `backgroundColor` + `print-color-adjust: exact`. The `exact` comes from `globals.css` `@media print` on the **`.nametag-band` class** (lines ~186-188) AND `.nametag-card` (~182-183) — so EVERY band gets it from CSS as long as it carries `className="nametag-band ..."`. The needs-routing and two-color bands ALSO set `printColorAdjust`/`WebkitPrintColorAdjust` inline (redundant belt-and-suspenders); the single van band relies on the class only — that is FINE, not a bug (verified 2026-06-18: the single band has `class="nametag-band"`, so the CSS rule covers it; no white-on-white regression). Cosmetic inconsistency only. Grayscale / "save ink" / non-conforming drivers can still print white bands regardless → **the color NAME text ("Blue van name" / "P") is the real failsafe and is present** — single band renders the VAN name + `{t.colorName ?? "P"}` (door-to-door: van is the headline); two-color shows `AM <name>`/`PM <name>`; needs-routing is literal red text. Never remove the name text. If you add a band variant, BOTH color names must be printed as text, not just swatches.

`@page { size: letter }` assumes US Letter — A4 paper mis-cuts the 2-up `2.4in` grid.

See [[color-derivation-and-fanout]] for the color chain + the parent-page revalidation gap.
