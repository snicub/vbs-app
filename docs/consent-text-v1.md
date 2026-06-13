# Consent text

Canonical text shown to parents at registration. Stored in
`src/lib/consents/text.ts`. SHA-256 hashed when the parent signs;
the hash plus the typed name + IP + UA is snapshotted into `consents`.

Current active version: **v3** (set by `CONSENT_VERSION`). Older versions
remain in the source file so we can show a parent exactly what they signed.

## v3 (active)

Three consents. The signature is the primary guardian's name (collected on the
form); there is no separate "type your name" field.

### media_release

> Photos and video of my child taken at VBS may appear in church publications,
> websites, and social media.

### general_liability

> VBS involves normal childhood play risks. I release the church and
> volunteers from liability for ordinary injuries.

### medical

> I will be reachable by phone during VBS hours and have an authorized adult
> available to respond in an emergency. I authorize staff to give routine first
> aid and to call emergency services if my child is hurt or sick.

## v2 (archived — kept for parents who already signed)

### media_release

> Photos and video of my child taken at VBS may appear in church publications,
> websites, and social media.

### medical

> Staff may give routine first aid and call emergency services if needed.
> I'll keep allergies and medications up to date.

### transport

> Church vans may drive my child between the assigned stop and VBS.
> I'll be at the stop on time, or send an authorized adult.

### general_liability

> VBS involves normal childhood play risks. I release the church and
> volunteers from liability for ordinary injuries.

### photo_release

> My child's photo may be printed on their wristband for staff identification.
> Photos are stored privately and deleted within 30 days after VBS.

## v1 (archived — kept for parents who already signed)

See `src/lib/consents/text.ts` under the `v1` key for the original wording.

## How to revise

1. Add a new top-level key (e.g. `v3`) in `src/lib/consents/text.ts` with the
   new wording. Don't edit existing versions.
2. Bump `CONSENT_VERSION` to the new key. Hashes are derived from text+version,
   so changing the active version makes new signups hash against the new text.
3. Update this document.
