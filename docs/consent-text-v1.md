# Consent text — version v1

Canonical text shown to parents at registration. Stored in
`src/lib/consents/text.ts`. SHA-256 hashed when the parent signs;
the hash plus the typed name + IP + UA is snapshotted into `consents`.

## media_release

> By signing, I grant the church permission to photograph my child during
> VBS activities and to use those images in church publications, websites,
> and social media.

## medical

> I authorize VBS staff to administer routine first aid and to contact
> emergency medical services in the event of injury or sudden illness.
> I will provide an up-to-date list of allergies and medications.

## transport

> I authorize my child to be transported between the designated pickup/
> dropoff stop and the VBS site by church-driven vehicles. I agree to
> provide accurate pickup/dropoff locations and to be present (or
> designate an authorized pickup person) at the scheduled time.

## general_liability

> I understand that VBS activities involve normal risks of childhood play.
> I release the church, its staff, and volunteers from liability for
> injuries arising from ordinary participation.

## photo_release

> I consent to my child's photo being printed on a wristband and used for
> visual identification by VBS staff during the event. Photos are stored
> privately and deleted within 30 days of the event ending.

## How to revise

1. Update the strings in `src/lib/consents/text.ts`
2. Bump the version key (e.g. `v1` → `v2`); the old key stays in the file
   so we can show parents what they signed
3. Update this document
