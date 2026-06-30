---
name: allergy-into-medical-notes
description: New signups write allergy info into medical_notes, not the allergies column — the van rider list still surfaces it loudly. allergies column is dead for fresh kids.
metadata:
  type: project
---

As of commit `bbf1cee` (2026-06-17, on `main`), the `/signup` form has ONE combined "Allergies & medical notes" box that writes into `medical_notes`. New kids get `allergies = null` (hard-set in `signup-form.tsx`), `medical_notes` carries the combined text.

**Why:** caregiver-friendly door-to-door simplification — one box instead of two.

**How it affects the van surface (verified GREEN, review-only):**
- `/van/[vanId]/page.tsx` selects BOTH `allergies` + `medical_notes` and maps each with `?? null`. No crash on null `allergies`.
- `SafetyCallout` (`state-badge.tsx`) returns null when both absent, renders `medicalNotes` as the LOUD rose/heart medical alert and `allergies` as a separate amber block. With new kids, the medical branch fires (combined text), the allergy branch silently skips. **No false-negative on the aide's allergy surface** — allergy info still shows, just under the medical alert.
- The photo-verify modal guards `(allergies || medicalNotes)` before rendering SafetyCallout — also fine.

**NOT a safety regression** for the aide: allergy data is still captured and still surfaced loudly on the van, just via `medical_notes`. The risk would only appear if some surface read `allergies` ONLY and ignored `medical_notes` — the van does not.

**Watch:** seeded/legacy kids may still have data in the `allergies` column; both columns are read everywhere on the van, so mixed data is fine. Don't "clean up" by dropping the `allergies` read from the van — it still serves old records.

Also in this batch (no van impact): State hard-set "SD" + ZIP dropped at signup (`needsVan` validation requires only street + town now); signup success screen trimmed. Neither touches van rider derivation, GPS, or offline — both commits changed ZERO files under `src/app/van/`, `src/lib/offline/`, `src/server-actions/{van,check-out,events}.ts`, `wake-lock.ts`, or `supabase/`.

Related: [[van-flow-known-bugs]]
