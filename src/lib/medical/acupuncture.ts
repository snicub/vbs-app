/**
 * Flags a medical/allergy note that mentions acupuncture (or close variants /
 * misspellings) so those kids can be collected onto the Acupuncture reference
 * list. Pure + tested so the keyword rule lives in one place.
 *
 * We normalize the note to letters-only and lowercase before matching, so
 * "acu-puncture", "Acu Puncture", and the common "accupuncture" misspelling all
 * hit. The pattern allows the doubled "c" and also catches "acupressure".
 */
const ACUPUNCTURE_RE = /ac+upunc|ac+upres/;

export function matchesAcupuncture(...notes: (string | null | undefined)[]): boolean {
  for (const note of notes) {
    if (!note) continue;
    const normalized = note.toLowerCase().replace(/[^a-z]/g, "");
    if (ACUPUNCTURE_RE.test(normalized)) return true;
  }
  return false;
}
