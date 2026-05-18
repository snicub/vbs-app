/**
 * Wristband alphabet — 5 chars, base32-style, but minus visually confusable
 * glyphs: 0/O, 1/I/l. We want a volunteer reading a wristband under
 * fluorescent lights at 7am to never mis-key.
 *
 * Keep this list locked. The checksum math assumes a 32-char alphabet.
 */

export const WRISTBAND_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const WRISTBAND_BASE = WRISTBAND_ALPHABET.length; // 32
export const WRISTBAND_LENGTH = 5;
export const PAYLOAD_LENGTH = WRISTBAND_LENGTH - 1;     // 4 payload + 1 checksum

if (WRISTBAND_BASE !== 32) {
  throw new Error("wristband alphabet must be exactly 32 chars");
}

const CHAR_TO_VALUE: ReadonlyMap<string, number> = new Map(
  Array.from(WRISTBAND_ALPHABET).map((ch, i) => [ch, i]),
);

export function charToValue(ch: string): number | null {
  return CHAR_TO_VALUE.get(ch) ?? null;
}

export function valueToChar(v: number): string {
  if (v < 0 || v >= WRISTBAND_BASE) throw new Error(`out of range: ${v}`);
  const ch = WRISTBAND_ALPHABET[v];
  if (!ch) throw new Error(`out of range: ${v}`);
  return ch;
}
