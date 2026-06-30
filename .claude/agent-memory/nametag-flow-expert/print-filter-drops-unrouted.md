---
name: print-filter-drops-unrouted
description: Any ?town= or ?van= filter on /coordinator/nametags silently excludes needs-routing kids (null town + null vanName) — print the unfiltered default sheet
metadata:
  type: feedback
---

Rule: to print name tags safely, use the DEFAULT unfiltered sheet (All towns / All vans). A `?town=` or `?van=` filter drops the needs-routing kids.

**Why:** `nametags/page.tsx` filter (`if (town && t.town !== town) return false; if (van && t.vanName !== van) return false;`) compares against the tag's derived `town`/`vanName`. A needs-routing kid (van kid with no resolved van) has `town = null` AND `vanName = null` (no stop → no town; headline falls back to "Parent drop-off"). So ANY active town/van filter evaluates `null !== "X"` → true → excludes them. If a coordinator prints per-van (filtering by van) to hand each van its stack, the unrouted kids print on NO sheet and get silently missed — the exact failure mode the loud red band was meant to prevent. They DO sort first on the unfiltered sheet, so the default view is safe.

**How to apply:** When anyone prints tags per-van/per-town, warn that unrouted kids are excluded by the filter; recommend they print the default sheet (unrouted kids lead it) or clear routing first. Verified 2026-06-29 final pre-event review. Related: the needs-routing band itself is correct (loud red, sorts first) — see [[door-to-door-tag-labeling]]; headline-uses-morningVanId nuance also there.
