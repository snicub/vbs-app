import { WRISTBAND_ALPHABET, PAYLOAD_LENGTH, WRISTBAND_BASE } from "./alphabet";
import { computeChecksumChar } from "./checksum";

function randomInt(maxExclusive: number): number {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0]! % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * Generate a single 5-char wristband code (4 random payload chars +
 * 1 checksum char). The caller is responsible for handling DB unique
 * collisions — retry on insert violation.
 */
export function generateWristbandCode(): string {
  let payload = "";
  for (let i = 0; i < PAYLOAD_LENGTH; i++) {
    payload += WRISTBAND_ALPHABET[randomInt(WRISTBAND_BASE)]!;
  }
  return payload + computeChecksumChar(payload);
}
