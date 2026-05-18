/**
 * Canonical consent text. Hashed at build time and snapshotted into the
 * `consents` table when a parent signs up so we can prove what they agreed to.
 *
 * Update the version key when wording changes. Old versions remain in the
 * codebase (or are recoverable from git) so we can show a parent what they
 * actually signed if they ask.
 */

export const CONSENT_VERSION = "v1" as const;

export const CONSENT_TEXT = {
  v1: {
    media_release: `By signing, I grant the church permission to photograph my child during VBS activities and to use those images in church publications, websites, and social media.`,
    medical: `I authorize VBS staff to administer routine first aid and to contact emergency medical services in the event of injury or sudden illness. I will provide an up-to-date list of allergies and medications.`,
    transport: `I authorize my child to be transported between the designated pickup/dropoff stop and the VBS site by church-driven vehicles. I agree to provide accurate pickup/dropoff locations and to be present (or designate an authorized pickup person) at the scheduled time.`,
    general_liability: `I understand that VBS activities involve normal risks of childhood play. I release the church, its staff, and volunteers from liability for injuries arising from ordinary participation.`,
    photo_release: `I consent to my child's photo being printed on a wristband and used for visual identification by VBS staff during the event. Photos are stored privately and deleted within 30 days of the event ending.`,
  },
} as const;

export type ConsentKind = keyof (typeof CONSENT_TEXT)[typeof CONSENT_VERSION];

export function consentText(kind: ConsentKind, version: keyof typeof CONSENT_TEXT = CONSENT_VERSION): string {
  return CONSENT_TEXT[version][kind];
}
