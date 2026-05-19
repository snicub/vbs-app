"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { submitEvent } from "@/server-actions/events";
import { smartCheckOut } from "@/server-actions/check-out";
import { broadcastVanLocation } from "@/server-actions/van";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";
import { requestScreenWakeLock } from "@/lib/wake-lock";

type RosterItem = {
  studentId: string;
  eventDate: string;
  state: string;
  name: string;
  wristbandCode: string;
  colorName: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  direction: "am" | "pm" | "both";
  stopName: string | null;
};

export function VanManifest({
  vanId,
  eventDate,
  roster,
}: {
  vanId: string;
  eventDate: string;
  roster: RosterItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [broadcasting, setBroadcasting] = useState(false);
  const [lastReportAt, setLastReportAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!broadcasting) {
      // Stop everything
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("This device has no GPS.");
      setBroadcasting(false);
      return;
    }

    // Acquire screen wake lock so the OS doesn't sleep mid-route
    requestScreenWakeLock().then((ctl) => {
      wakeLockRef.current = ctl;
      if (!ctl.isSupported) {
        toast.warning(
          "Screen Wake Lock unsupported on this browser — keep the phone awake manually.",
        );
      }
    });

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setError(null);
        const result = await broadcastVanLocation({
          vanId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          headingDeg: pos.coords.heading ?? undefined,
          speedMps: pos.coords.speed ?? undefined,
        });
        if (!result.ok) {
          setError(result.ok ? null : result.error);
          toast.error(result.error);
        } else {
          setLastReportAt(new Date());
        }
      },
      (err) => {
        setError(err.message);
        toast.error(`GPS error: ${err.message}`);
        setBroadcasting(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    );

    // If the page is hidden and comes back, restart the watch (some browsers
    // pause watchPosition while backgrounded).
    function onVisibility() {
      if (document.visibilityState === "visible" && broadcasting && watchIdRef.current === null) {
        setBroadcasting(false);
        setBroadcasting(true); // triggers the effect to re-run
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasting, vanId]);

  function fireCheckOut(studentId: string) {
    startTransition(async () => {
      const result = await smartCheckOut({ studentId, eventDate });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Dropped off — kid is home");
      router.refresh();
    });
  }

  function fire(studentId: string, eventType: string) {
    startTransition(async () => {
      const result = await submitEvent({
        studentId,
        eventDate,
        eventType,
        vanId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div
        className={
          "rounded-lg border p-4 flex items-center justify-between gap-3 " +
          (broadcasting ? "bg-green-500/10 border-green-500/30" : "bg-card")
        }
      >
        <div className="text-sm space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">Location broadcast</span>
            {broadcasting ? (
              <Badge variant="success">live</Badge>
            ) : (
              <Badge variant="muted">off</Badge>
            )}
          </div>
          {broadcasting ? (
            <div className="text-xs text-muted-foreground">
              {lastReportAt
                ? `Last position sent at ${lastReportAt.toLocaleTimeString()}.`
                : "Waiting for first GPS fix…"}{" "}
              Keep this tab open and screen on; backgrounding may pause broadcasts.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Turn on to broadcast this van&apos;s GPS to the coordinator map.
            </div>
          )}
          {error && (
            <div className="text-xs text-destructive">Error: {error}</div>
          )}
        </div>
        <Button
          variant={broadcasting ? "destructive" : "default"}
          onClick={() => setBroadcasting((v) => !v)}
        >
          {broadcasting ? "Stop" : "Start broadcast"}
        </Button>
      </div>

      <ul className="space-y-3">
        {roster.map((r) => (
          <li key={r.studentId} className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {r.wristbandCode} · {r.colorName ?? "no color"} ·{" "}
                  {r.direction === "both" ? "AM+PM" : r.direction.toUpperCase()}
                  {r.stopName ? ` · ${r.stopName}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-muted-foreground tracking-wide">
                  Status
                </div>
                <div className="text-sm font-medium">
                  {STATE_LABEL[r.state as DayState] ?? r.state}
                </div>
              </div>
            </div>

            {(r.allergies || r.medicalNotes) && (
              <div className="rounded border border-yellow-500/40 bg-yellow-50 p-2 text-xs space-y-1 dark:bg-yellow-900/20">
                {r.allergies && <div><strong>Allergies:</strong> {r.allergies}</div>}
                {r.medicalNotes && <div><strong>Medical:</strong> {r.medicalNotes}</div>}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {r.direction !== "pm" && r.state === "not_started" && (
                <Button size="sm" disabled={pending} onClick={() => fire(r.studentId, "van_boarded_am")}>
                  Boarded AM van
                </Button>
              )}
              {r.direction !== "am" && (r.state === "site_checked_in" || r.state === "site_checked_out" || r.state === "van_boarded_pm") && (
                <Button size="sm" disabled={pending} onClick={() => fireCheckOut(r.studentId)}>
                  Dropped off (check out)
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
