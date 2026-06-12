"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { submitEvent } from "@/server-actions/events";
import { smartCheckOut } from "@/server-actions/check-out";
import { broadcastVanLocation } from "@/server-actions/van";
import { isLegalTransition } from "@/lib/events/state-machine";
import { STATE_PRESENTATION, safeDayState } from "@/lib/state-presentation";
import { StateBadge, SafetyCallout } from "@/components/state-badge";
import { requestScreenWakeLock } from "@/lib/wake-lock";
import { BusIcon, HomeIcon, MapPinIcon, RadioIcon, RadioTowerIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type RosterItem = {
  studentId: string;
  eventDate: string;
  state: string;
  name: string;
  wristbandCode: string;
  colorName: string | null;
  colorHex: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  direction: "am" | "pm" | "both";
  stopName: string | null;
  stopOrder: number;
  photoUrl: string | null;
};

function groupByStop(
  roster: RosterItem[],
): { stopName: string | null; items: RosterItem[] }[] {
  const groups: { stopName: string | null; items: RosterItem[] }[] = [];
  for (const item of roster) {
    const last = groups[groups.length - 1];
    if (last && last.stopName === item.stopName) {
      last.items.push(item);
    } else {
      groups.push({ stopName: item.stopName, items: [item] });
    }
  }
  return groups;
}

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
  const [pendingStudents, setPendingStudents] = useState<Set<string>>(new Set());
  const [broadcasting, setBroadcasting] = useState(false);
  const [lastReportAt, setLastReportAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Photo-verify modal: shown before van_boarded_pm fires so the driver
  // confirms the kid's face matches the name. Prevents the worst failure
  // mode (wrong kid on wrong van).
  const [verifyTarget, setVerifyTarget] = useState<RosterItem | null>(null);
  const [verifyArmedAt, setVerifyArmedAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastBroadcastRef = useRef<number>(0);

  useEffect(() => {
    if (!broadcasting) {
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
        const now = Date.now();
        if (now - lastBroadcastRef.current < 15_000) return;
        lastBroadcastRef.current = now;
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
          setError(result.error);
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

    function onVisibility() {
      if (document.visibilityState === "visible" && broadcasting && watchIdRef.current === null) {
        setBroadcasting(false);
        setBroadcasting(true);
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

  function addPending(studentId: string) {
    setPendingStudents((prev) => new Set(prev).add(studentId));
  }
  function removePending(studentId: string) {
    setPendingStudents((prev) => {
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
  }

  type VerifyAction = "board_am" | "drop_off";
  const [verifyAction, setVerifyAction] = useState<VerifyAction | null>(null);

  /** Open the photo-verify modal for the given action. Mismatched kid-to-van
   *  is the worst failure mode — we force the driver to look at the photo
   *  before any boarding or dropoff is recorded. */
  function requestVerify(item: RosterItem, action: VerifyAction) {
    setVerifyTarget(item);
    setVerifyAction(action);
    setVerifyArmedAt(Date.now());
  }

  function cancelVerify() {
    setVerifyTarget(null);
    setVerifyAction(null);
    setVerifyArmedAt(null);
  }

  function confirmVerify() {
    if (!verifyTarget || !verifyAction) return;
    const target = verifyTarget;
    cancelVerify();
    if (verifyAction === "board_am") {
      fire(target.studentId, "van_boarded_am");
    } else {
      fireCheckOut(target.studentId);
    }
  }

  function fireCheckOut(studentId: string) {
    addPending(studentId);
    void smartCheckOut({ studentId, eventDate })
      .then((result) => {
        removePending(studentId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Dropped off — kid is home");
        router.refresh();
      })
      .catch(() => {
        removePending(studentId);
        toast.error("Network error — try again");
      });
  }

  function fire(studentId: string, eventType: string) {
    addPending(studentId);
    void submitEvent({ studentId, eventDate, eventType, vanId })
      .then((result) => {
        removePending(studentId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Recorded");
        router.refresh();
      })
      .catch(() => {
        removePending(studentId);
        toast.error("Network error — try again");
      });
  }

  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-4 flex items-center justify-between gap-3 transition-colors",
          broadcasting
            ? "bg-[var(--state-safe)]/10 border-[var(--state-safe)]/40"
            : "bg-card",
        )}
      >
        <div className="text-sm space-y-1 min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            {broadcasting ? (
              <RadioTowerIcon className="size-4 text-[var(--state-safe)] animate-pulse" />
            ) : (
              <RadioIcon className="size-4 text-muted-foreground" />
            )}
            Van location broadcast
            <span
              className={cn(
                "ml-1 text-xs font-medium rounded-md border px-2 py-0.5",
                broadcasting
                  ? "bg-[var(--state-safe)]/15 text-[var(--state-safe)] border-[var(--state-safe)]/35"
                  : "bg-muted text-muted-foreground border-border",
              )}
            >
              {broadcasting ? "live" : "off"}
            </span>
          </div>
          {broadcasting ? (
            <div className="text-xs text-muted-foreground">
              {lastReportAt
                ? `Last GPS at ${lastReportAt.toLocaleTimeString()}.`
                : "Waiting for first GPS fix…"}{" "}
              Keep the screen on; backgrounding may pause broadcasts.
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
          variant={broadcasting ? "outline" : "default"}
          size="lg"
          onClick={() => setBroadcasting((v) => !v)}
        >
          {broadcasting ? "Stop" : "Start broadcast"}
        </Button>
      </div>

      <div className="space-y-6 mt-4">
        {groupByStop(roster).map(({ stopName, items }) => (
          <section key={stopName ?? "__none"}>
            <div className="flex items-center gap-2 mb-3">
              <MapPinIcon className="size-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold text-foreground">
                {stopName ?? "Unknown stop"}
              </span>
              <span className="text-xs text-muted-foreground">
                ({items.length} kid{items.length === 1 ? "" : "s"})
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <ul className="space-y-3">
              {items.map((r) => {
                const state = safeDayState(r.state);
                const presentation = STATE_PRESENTATION[state];
                const isPending = pendingStudents.has(r.studentId);
                const canBoardAm =
                  r.direction !== "pm" &&
                  isLegalTransition(state, "van_boarded_am");
                const canCheckOut =
                  r.direction !== "am" &&
                  (isLegalTransition(state, "site_checked_out") ||
                    isLegalTransition(state, "van_offloaded_pm") ||
                    isLegalTransition(state, "parent_pickup"));
                return (
                  <li
                    key={r.studentId}
                    className="rounded-xl border bg-card overflow-hidden"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor:
                        state === "not_started"
                          ? "var(--border)"
                          : `var(--state-${presentation.tone})`,
                    }}
                  >
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-base truncate">
                            {r.name}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span>{r.wristbandCode}</span>
                            {r.colorHex && (
                              <span
                                className="inline-block w-3.5 h-3.5 rounded-full border ring-1 ring-border"
                                style={{ backgroundColor: r.colorHex }}
                                aria-hidden
                                title={r.colorName ?? undefined}
                              />
                            )}
                            <span>{r.colorName ?? "no color"}</span>
                            <span>·</span>
                            <span>
                              {r.direction === "both"
                                ? "AM+PM"
                                : r.direction.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <StateBadge state={state} size="sm" />
                      </div>

                      <SafetyCallout
                        allergies={r.allergies}
                        medicalNotes={r.medicalNotes}
                        density="compact"
                      />

                      {(canBoardAm || canCheckOut) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {canBoardAm && (
                            <Button
                              size="lg"
                              disabled={isPending}
                              onClick={() => requestVerify(r, "board_am")}
                            >
                              <BusIcon /> Boarded AM van
                            </Button>
                          )}
                          {canCheckOut && (
                            <Button
                              size="lg"
                              disabled={isPending}
                              onClick={() => requestVerify(r, "drop_off")}
                            >
                              <HomeIcon /> Dropped off (check out)
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {verifyTarget && verifyAction && verifyArmedAt !== null && (
        <PhotoVerifyModal
          target={verifyTarget}
          armedAt={verifyArmedAt}
          action={verifyAction}
          onConfirm={confirmVerify}
          onCancel={cancelVerify}
        />
      )}
    </>
  );
}

const VERIFY_TAP_THROUGH_MS = 1500;

function PhotoVerifyModal({
  target,
  armedAt,
  action,
  onConfirm,
  onCancel,
}: {
  target: RosterItem;
  armedAt: number;
  action: "board_am" | "drop_off";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, VERIFY_TAP_THROUGH_MS - (now - armedAt));
  const armed = remainingMs === 0;
  const actionLabel = action === "board_am" ? "Boarded AM van" : "Dropped off — going home";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-verify-title"
      className="fixed inset-0 z-[1200] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border-2 border-primary p-4 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-1">
          <div
            id="photo-verify-title"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Confirm the kid
          </div>
          <div className="text-2xl font-bold">{target.name}</div>
          <div className="text-xs text-muted-foreground font-mono flex items-center justify-center gap-2">
            <span>{target.wristbandCode}</span>
            {target.colorHex && (
              <span
                className="inline-block w-4 h-4 rounded-full border ring-1 ring-border"
                style={{ backgroundColor: target.colorHex }}
                aria-hidden
              />
            )}
            {target.colorName && <span>{target.colorName}</span>}
          </div>
        </div>

        <div className="mx-auto w-48 h-48 rounded-xl border bg-muted flex items-center justify-center overflow-hidden">
          {target.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={target.photoUrl}
              alt={target.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-sm text-muted-foreground text-center px-2">
              No photo on file. Verify by name + wristband only.
            </span>
          )}
        </div>

        {target.stopName && (
          <div className="text-center text-sm">
            <span className="text-muted-foreground">Stop:</span>{" "}
            <strong>{target.stopName}</strong>
          </div>
        )}

        {(target.allergies || target.medicalNotes) && (
          <SafetyCallout
            allergies={target.allergies}
            medicalNotes={target.medicalNotes}
            density="compact"
          />
        )}

        <div className="flex gap-2 flex-col sm:flex-row">
          <Button
            size="lg"
            className="flex-1"
            onClick={onConfirm}
            disabled={!armed}
          >
            {armed
              ? `Yes — ${actionLabel}`
              : `Wait ${Math.ceil(remainingMs / 1000)}s…`}
          </Button>
          <Button size="lg" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
