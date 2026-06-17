"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, CloudOffIcon, RefreshCwIcon } from "lucide-react";

/**
 * Persistent connectivity + sync status for the van flow. Hidden entirely when
 * online with an empty queue. Loud when offline (so the driver knows actions are
 * saved locally and that the roster on screen is frozen) and when something
 * failed to sync (so it's never missed).
 */
export function OfflineBanner({
  isOnline,
  pending,
  failedCount,
  loadedAt,
  onRetry,
}: {
  isOnline: boolean;
  pending: number;
  failedCount: number;
  loadedAt?: string;
  onRetry: () => void;
}) {
  if (isOnline && pending === 0 && failedCount === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {!isOnline && (
        <div className="rounded-xl border-2 border-[var(--anomaly-warn)]/40 bg-[var(--anomaly-warn)]/10 px-4 py-3 text-base font-semibold">
          <div className="flex items-center gap-2.5">
            <CloudOffIcon className="size-5 shrink-0 text-[var(--anomaly-warn)]" />
            <span>
              Offline
              {pending > 0
                ? ` — ${pending} saved here, will sync when you're back online`
                : " — your taps are saved here and sync when you're back online"}
            </span>
          </div>
          {loadedAt && (
            <div className="mt-1 text-sm font-normal text-muted-foreground">
              Roster shown is from {fmtTime(loadedAt)} — may be out of date.
            </div>
          )}
        </div>
      )}

      {isOnline && pending > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-base">
          <RefreshCwIcon className="size-5 shrink-0 animate-spin" />
          <span>Syncing {pending} saved action{pending === 1 ? "" : "s"}…</span>
        </div>
      )}

      {failedCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3 text-base font-semibold">
          <AlertTriangleIcon className="size-5 shrink-0 text-destructive" />
          <span className="flex-1">
            {failedCount} action{failedCount === 1 ? "" : "s"} couldn&apos;t sync
          </span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCwIcon /> Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "earlier"
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
