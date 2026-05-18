import { WRISTBAND_LENGTH, PAYLOAD_LENGTH, charToValue } from "./alphabet";
import { computeChecksumChar } from "./checksum";

export type WristbandValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: "length" | "charset" | "checksum" };

/**
 * Validate a possibly-noisy user-typed wristband code.
 *
 * Pre-normalizations applied before validation:
 *   - upper-case
 *   - O → 0 is NOT applied (0 isn't in the alphabet, so an O on the band
 *     could only have been printed in error; a 0 typed by a volunteer is
 *     never valid). Same for 1/I/L.
 *   - strip whitespace and dashes
 *
 * Returns either { ok: true, normalized } or a failure reason.
 */
export function validateWristbandCode(input: string): WristbandValidationResult {
  const normalized = input.replace(/[\s-]/g, "").toUpperCase();

  if (normalized.length !== WRISTBAND_LENGTH) {
    return { ok: false, reason: "length" };
  }

  for (const ch of normalized) {
    if (charToValue(ch) === null) {
      return { ok: false, reason: "charset" };
    }
  }

  const payload = normalized.slice(0, PAYLOAD_LENGTH);
  const provided = normalized.slice(PAYLOAD_LENGTH);
  if (computeChecksumChar(payload) !== provided) {
    return { ok: false, reason: "checksum" };
  }

  return { ok: true, normalized };
}
