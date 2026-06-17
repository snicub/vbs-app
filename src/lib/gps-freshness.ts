/**
 * Classify a van's last GPS report by age so the live map never shows a van that
 * has gone dark (dead phone, closed app, lost signal) as if it were live. Vans
 * report roughly every 15s, so a couple of missed reports is "stale" and a long
 * gap is "dark" — a coordinator should physically check on a dark van.
 */
export type GpsFreshness = "fresh" | "stale" | "dark";

export function gpsFreshness(
  reportedAtMs: number,
  nowMs: number,
  opts?: { staleAfterSec?: number; darkAfterSec?: number },
): GpsFreshness {
  const staleAfter = opts?.staleAfterSec ?? 120;
  const darkAfter = opts?.darkAfterSec ?? 600;
  const ageSec = Math.max(0, (nowMs - reportedAtMs) / 1000);
  if (ageSec >= darkAfter) return "dark";
  if (ageSec >= staleAfter) return "stale";
  return "fresh";
}
