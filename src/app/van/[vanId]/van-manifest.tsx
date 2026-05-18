"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { submitEvent } from "@/server-actions/events";
import { broadcastVanLocation } from "@/server-actions/van";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";

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

  useEffect(() => {
    if (!broadcasting) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("This device has no GPS.");
      setBroadcasting(false);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const result = await broadcastVanLocation({
          vanId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          headingDeg: pos.coords.heading ?? undefined,
          speedMps: pos.coords.speed ?? undefined,
        });
        if (!result.ok) toast.error(result.error);
      },
      (err) => {
        toast.error(`GPS error: ${err.message}`);
        setBroadcasting(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [broadcasting, vanId]);

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
      <div className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">Location broadcast</div>
          <div className="text-muted-foreground">
            {broadcasting ? "Sending GPS to coordinator." : "Off."}
          </div>
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
              {r.direction !== "pm" && (
                <>
                  <Button size="sm" disabled={pending} onClick={() => fire(r.studentId, "van_boarded_am")}>
                    Board AM
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => fire(r.studentId, "van_offloaded_am")}>
                    Off AM
                  </Button>
                </>
              )}
              {r.direction !== "am" && (
                <>
                  <Button size="sm" disabled={pending} onClick={() => fire(r.studentId, "van_boarded_pm")}>
                    Board PM
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => fire(r.studentId, "van_offloaded_pm")}>
                    Off PM
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
