---
name: photo-consent-gap
description: Photo is collected at signup but NO active (v3) consent covers wristband-photo use; media_release covers publication only.
metadata:
  type: project
---

A child's photo is collected at `/signup` (optional, `<details>` in `signup-form.tsx`) and stored in the private `student-photos` bucket, but **no active consent covers using/storing that photo.**

- `CONSENT_VERSION = "v3"` (`src/lib/consents/text.ts`) has only 3 kinds: `media_release`, `general_liability`, `medical`. The old `photo_release` ("photo printed on wristband, stored privately, deleted within 30 days") exists only in **v1/v2** and is NOT sent.
- v3 `media_release` covers photos appearing in church publications/website/social — that is NOT the same as the operational "store the kid's photo for staff identification" use.
- The signup form's `CONSENT_LABELS` map still lists `photo_release: "Wristband photo use"`, but the rendered/sent consents come from the server-built `consents` prop (v3 text), so that label is dead — photo_release is never shown or submitted.

**Why:** v3 (2026-06-13 registration rework) deliberately dropped transport + photo_release from the active set. Photo upload was kept.

**How to apply:** This is an ACCEPTED gap for the one-time event, NOT a blocker for sending the public link — photo is optional and goes to a private bucket. If photo use ever becomes a hard requirement (e.g. printed on wristbands for ID), that's a registration/consent change: bump CONSENT_VERSION, re-add a photo consent kind, wire it through `registerFamily`'s per-kind check. Coordinate with [[registration-flow-expert]] — do not silently rely on media_release covering it.
