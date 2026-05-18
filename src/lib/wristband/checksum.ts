import { charToValue, valueToChar, WRISTBAND_BASE } from "./alphabet";

/**
 * Compute the checksum char for a payload string.
 * Weighted modular sum over the 32-char alphabet. Weights are coprime with
 * the modulus and with each other so a single-char typo flips the checksum.
 */
const WEIGHTS = [7, 11, 13, 17] as const;

export function computeChecksumChar(payload: string): string {
  if (payload.length !== WEIGHTS.length) {
    throw new Error(`payload must be ${WEIGHTS.length} chars, got ${payload.length}`);
  }
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i]!;
    const v = charToValue(ch);
    if (v === null) {
      throw new Error(`invalid char in payload: '${ch}'`);
    }
    sum += v * WEIGHTS[i]!;
  }
  return valueToChar(sum % WRISTBAND_BASE);
}
