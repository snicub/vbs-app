---
name: dialog-primitive-gap
description: There is NO shared Dialog/Modal primitive in components/ui — modals are hand-rolled per-screen; confirm-dialog.tsx is the first reusable one
metadata:
  type: project
---

`src/components/ui/` has NO `dialog.tsx` / shadcn Dialog, despite CLAUDE.md and review prompts assuming one ("reuse the existing Dialog + Button"). The ui set is: badge, button, checkbox, confirm-dialog, input, label, select, sonner, textarea.

`@base-ui/react/dialog` IS installed (node_modules) but unused. Modals are currently hand-rolled `<div role="dialog" aria-modal="true">` overlays:
- `src/app/van/[vanId]/van-manifest.tsx` (photo-verify modal) — the established hand-rolled pattern, has `aria-labelledby`.
- `src/components/ui/confirm-dialog.tsx` (NEW) — first attempt at a *reusable* confirm modal, also hand-rolled (not built on Base UI Dialog).

**Why:** matters for review — a request to "reuse the existing Dialog" cannot be satisfied; there is none. Both hand-rolled modals lack a real focus trap and Base UI's portal/scroll-lock/inert behavior.

**How to apply:** If asked to add/standardize dialogs, the right move is to either (a) build one shared `ui/dialog.tsx` on the already-installed `@base-ui/react/dialog` and migrate both hand-rolled modals to it, or (b) accept the hand-rolled pattern but fix its a11y gaps (focus trap, initial focus, `aria-labelledby`/`aria-describedby`). Don't claim a Dialog primitive exists. Related: [[presentation-contract]].
