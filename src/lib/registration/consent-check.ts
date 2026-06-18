/**
 * Pure consent-set validation for the public registration endpoint. The schema
 * only checks `min(3)`; these two guards are the real gate (the endpoint is
 * unauthenticated, so a crafted payload must not slip weaker consents through):
 *
 *  - Version pin: every agreed consent must be the CURRENT version. CONSENT_TEXT
 *    keeps older versions only for displaying already-signed records; accepting
 *    one on a NEW signup would record weaker wording (e.g. v1 medical, which
 *    omits the guardian-availability clause).
 *  - Kind completeness: exactly the required kinds, with no duplicates and no
 *    extras (three copies of one consent must not pass as "three consents").
 *
 * Hash verification stays in the server action (it needs async crypto); this
 * runs first so a downgrade or a missing kind is rejected before any DB work.
 */

export type ConsentInput = { kind: string; textVersion: string };

export type ConsentCheckResult = { ok: true } | { ok: false; error: string };

export function validateConsentSet(
  agreed: ConsentInput[],
  requiredKinds: string[],
  currentVersion: string,
): ConsentCheckResult {
  for (const c of agreed) {
    if (c.textVersion !== currentVersion) {
      return {
        ok: false,
        error: "Consent text has changed. Please reload the page and try again.",
      };
    }
  }

  // Exactly the required kinds: right count (a duplicate would inflate length but
  // not the Set, so check both), no extras, none missing. The length guard also
  // blocks a duplicate consent row, which the DB doesn't uniquely constrain.
  const kinds = new Set(agreed.map((c) => c.kind));
  if (
    agreed.length !== requiredKinds.length ||
    kinds.size !== requiredKinds.length ||
    !requiredKinds.every((k) => kinds.has(k))
  ) {
    return { ok: false, error: "Please agree to all required consents." };
  }

  return { ok: true };
}
