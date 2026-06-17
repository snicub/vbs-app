/**
 * A unique id that works even where `crypto.randomUUID` is missing — older
 * in-app webviews and any non-secure origin (http LAN dev link) don't expose it,
 * and a thrown call there would lose the driver's tap. Uniqueness is all we need
 * here (idempotency / dedup keys, not a security token), so the fallback is fine.
 */
export function clientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
