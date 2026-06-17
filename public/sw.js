// KILL SWITCH — the experimental offline cache caused stale/unstyled loads.
// This worker no longer intercepts any request; on activation it clears its
// caches and unregisters itself. A browser still running the old worker will
// fetch this updated file, install it, and self-destruct, then reload its tabs.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("vbs-")).map((k) => caches.delete(k)),
      );
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
// No 'fetch' handler — requests go straight to the network.
