"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the current route's server components every `intervalMs` so
 * server-rendered pages stay fresh without a full reload. Used on the
 * public parent status page (no auth, so no realtime subscription).
 *
 * Cheap: router.refresh streams only changed segments. Default 30s is
 * tuned for parent expectations during van pickup (visible state change
 * within ~30s feels live).
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
