/**
 * Stable hash of the canonical consent text the parent saw at signing time.
 * SHA-256 hex. Used as a tamper-evident snapshot.
 *
 * Works in both Node and the browser via the WebCrypto API.
 */

export async function hashConsentText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
