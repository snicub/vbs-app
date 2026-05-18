import { uuidv7 } from "uuidv7";

/**
 * Generate an idempotency key for a client-initiated write.
 *
 * Format: "<scope>:<uuidv7>" so server logs reveal what the key was for.
 * Keys are unique by construction (uuidv7 is a 128-bit time-ordered UUID).
 *
 * Typical scopes: "checkin", "checkout", "van_board_am", "override", ...
 */
export function newIdempotencyKey(scope: string): string {
  if (!scope || /[:\s]/.test(scope)) {
    throw new Error(`invalid scope: '${scope}'`);
  }
  return `${scope}:${uuidv7()}`;
}

/**
 * Extract the scope portion of a key, or null if it doesn't follow the format.
 */
export function scopeOf(key: string): string | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return key.slice(0, idx);
}
