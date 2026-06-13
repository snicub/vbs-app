/**
 * Canonical consent text. Hashed at build time and snapshotted into the
 * `consents` table when a parent signs up so we can prove what they agreed to.
 *
 * Bump CONSENT_VERSION when wording changes. Old versions stay in the file so
 * we can show a parent exactly what they signed if asked.
 */

export const CONSENT_VERSION = "v3" as const;

export const CONSENT_TEXT = {
  v1: {
    media_release: `By signing, I grant the church permission to photograph my child during VBS activities and to use those images in church publications, websites, and social media.`,
    medical: `I authorize VBS staff to administer routine first aid and to contact emergency medical services in the event of injury or sudden illness. I will provide an up-to-date list of allergies and medications.`,
    transport: `I authorize my child to be transported between the designated pickup/dropoff stop and the VBS site by church-driven vehicles. I agree to provide accurate pickup/dropoff locations and to be present (or designate an authorized pickup person) at the scheduled time.`,
    general_liability: `I understand that VBS activities involve normal risks of childhood play. I release the church, its staff, and volunteers from liability for injuries arising from ordinary participation.`,
    photo_release: `I consent to my child's photo being printed on a wristband and used for visual identification by VBS staff during the event. Photos are stored privately and deleted within 30 days of the event ending.`,
  },
  v2: {
    media_release: `Photos and video of my child taken at VBS may appear in church publications, websites, and social media.`,
    medical: `Staff may give routine first aid and call emergency services if needed. I'll keep allergies and medications up to date.`,
    transport: `Church vans may drive my child between the assigned stop and VBS. I'll be at the stop on time, or send an authorized adult.`,
    general_liability: `VBS involves normal childhood play risks. I release the church and volunteers from liability for ordinary injuries.`,
    photo_release: `My child's photo may be printed on their wristband for staff identification. Photos are stored privately and deleted within 30 days after VBS.`,
  },
  v3: {
    media_release: `Photos and video of my child taken at VBS may appear in church publications, websites, and social media.`,
    general_liability: `VBS involves normal childhood play risks. I release the church and volunteers from liability for ordinary injuries.`,
    medical: `I will be reachable by phone during VBS hours and have an authorized adult available to respond in an emergency. I authorize staff to give routine first aid and to call emergency services if my child is hurt or sick.`,
  },
} as const;

export type ConsentKind = keyof (typeof CONSENT_TEXT)[typeof CONSENT_VERSION];

export function consentText(
  kind: ConsentKind,
  version: keyof typeof CONSENT_TEXT = CONSENT_VERSION,
): string {
  return CONSENT_TEXT[version][kind];
}
