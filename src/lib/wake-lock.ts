/**
 * Thin wrapper around the Screen Wake Lock API. Returns a cleanup function
 * that releases the lock when the caller stops needing it. Re-acquires when
 * the document becomes visible again — the browser auto-releases the lock
 * on tab hide, so the visibility listener is essential for usefulness.
 *
 * No-ops gracefully if the API isn't supported (older Safari, in-app browsers).
 */

type LockController = {
  release: () => Promise<void>;
  isSupported: boolean;
};

type WakeLockSentinelLike = {
  release(): Promise<void>;
  released?: boolean;
};

type WakeLockApi = {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
};

export async function requestScreenWakeLock(): Promise<LockController> {
  const wakeLockNav = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;

  if (!wakeLockNav?.request) {
    return { release: async () => {}, isSupported: false };
  }

  let sentinel: WakeLockSentinelLike | null = null;

  async function acquire() {
    try {
      sentinel = await wakeLockNav!.request("screen");
    } catch {
      sentinel = null;
    }
  }

  async function onVisibility() {
    if (document.visibilityState === "visible" && (sentinel === null || sentinel.released)) {
      await acquire();
    }
  }

  await acquire();
  document.addEventListener("visibilitychange", onVisibility);

  return {
    isSupported: true,
    async release() {
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        await sentinel?.release();
      } catch {
        // already released
      }
      sentinel = null;
    },
  };
}
