"use client";

import { useEffect } from "react";

/**
 * Service-worker KILL SWITCH.
 *
 * The experimental offline service worker could serve a stale, unstyled app
 * shell (cached HTML referencing chunks that changed), so we no longer register
 * one. This actively unregisters any SW a browser already installed and clears
 * its caches, so a single refresh fully recovers. Offline WRITES still work via
 * the localStorage outbox; only cold-open caching is gone (and it wasn't
 * verified anyway).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((keys) =>
          keys.filter((k) => k.startsWith("vbs-")).forEach((k) => caches.delete(k)),
        )
        .catch(() => {});
    }
  }, []);

  return null;
}
