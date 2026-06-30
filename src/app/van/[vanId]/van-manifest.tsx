"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { submitEvent, cancelBoarding } from "@/server-actions/events";
import { smartCheckOut } from "@/server-actions/check-out";
import { broadcastVanLocation } from "@/server-actions/van";
import { isLegalTransition } from "@/lib/events/state-machine";
import { STATE_PRESENTATION, safeDayState } from "@/lib/state-presentation";
import { StateBadge, SafetyCallout } from "@/components/state-badge";
import { requestScreenWakeLock } from "@/lib/wake-lock";
import { BusIcon, HomeIcon, MapPinIcon, RadioIcon, RadioTowerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOutbox } from "@/lib/offline/use-outbox";
import { OfflineBanner } from "@/components/offline-banner";
import { clientId } from "@/lib/offline/uuid";

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
  homeAddress: string | null;
  homeNotes: string | null;
  homeMapsUrl: string | null;
  photoUrl: string | null;
};

export function VanManifest({
  vanId,
  eventDate,
  roster,
  loadedAt,
}: {
  vanId: string;
  eventDate: string;
  roster: RosterItem[];
  loadedAt: string;
}) {
  const router = useRouter();
  const outbox = useOutbox({ submitEvent, smartCheckOut });
  const [pendingStudents, setPendingStudents] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // Auto-start location sharing on landing so the aide doesn't have to find the
  // toggle — opening the van page prompts for GPS permission immediately. They
  // can still tap "Stop GPS" to turn it off.
  const [broadcasting, setBroadcasting] = useState(true);
  const [lastReportAt, setLastReportAt] = useState<Date | null>(null);
  const [gpsReachable, setGpsReachable] = useState(true);
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
        try {
          const result = await broadcastVanLocation({
            vanId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
            headingDeg: pos.coords.heading ?? undefined,
            speedMps: pos.coords.speed ?? undefined,
          });
          // Don't toast on every failed 15s tick (it would spam while offline).
          // Show one calm inline status in the GPS card instead.
          if (!result.ok) {
            setGpsReachable(false);
          } else {
            setGpsReachable(true);
            setError(null);
            setLastReportAt(new Date());
          }
        } catch {
          // Request never landed (offline) — location isn't reaching the server.
          setGpsReachable(false);
        }
      },
      (err) => {
        // Only a real permission block should stop sharing. A slow first fix or a
        // dropped signal (timeout / position unavailable) must NOT flip GPS off —
        // watchPosition keeps trying, so we just show "not reaching" and wait.
        if (err.code === err.PERMISSION_DENIED) {
          setError(
            "Location is blocked. Tap the lock/location icon in your browser's address bar, set Location to Allow, then reload.",
          );
          toast.error("Location is blocked — allow it in your browser, then reload.");
          setBroadcasting(false);
        } else {
          setGpsReachable(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
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
    const dedupKey = clientId();
    const occurredAt = new Date().toISOString();
    const payload = { studentId, eventDate, occurredAt };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      outbox.enqueue({ kind: "smartCheckOut", studentId, dedupKey, payload });
      toast.success("Saved offline — will sync when you're back online");
      return;
    }
    addPending(studentId);
    void smartCheckOut(payload)
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
        // Request never landed (offline/timeout) — save it and sync later.
        removePending(studentId);
        outbox.enqueue({ kind: "smartCheckOut", studentId, dedupKey, payload });
        toast.success("Saved offline — will sync when you're back online");
      });
  }

  function cancelBoardingFor(studentId: string) {
    addPending(studentId);
    void cancelBoarding({ studentId, eventDate })
      .then((result) => {
        removePending(studentId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Boarding cancelled");
        router.refresh();
      })
      .catch(() => {
        removePending(studentId);
        toast.error("Couldn't cancel — check your connection and try again.");
      });
  }

  function fire(studentId: string, eventType: string) {
    // Client-generated key so an offline replay dedupes to one event; captured
    // time so the event records when it happened, not when it later syncs.
    const idempotencyKey = clientId();
    const occurredAt = new Date().toISOString();
    const payload = { studentId, eventDate, eventType, vanId, idempotencyKey, occurredAt };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      outbox.enqueue({ kind: "submitEvent", studentId, dedupKey: idempotencyKey, payload });
      toast.success("Saved offline — will sync when you're back online");
      return;
    }
    addPending(studentId);
    void submitEvent(payload)
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
        outbox.enqueue({ kind: "submitEvent", studentId, dedupKey: idempotencyKey, payload });
        toast.success("Saved offline — will sync when you're back online");
      });
  }

  return (
    <>
      <OfflineBanner
        isOnline={outbox.isOnline}
        pending={outbox.pending}
        failedCount={outbox.failedCount}
        loadedAt={loadedAt}
        onRetry={outbox.retryFailed}
      />
      <div
        className={cn(
          "rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors sm:flex-row sm:items-center sm:justify-between",
          broadcasting
            ? "bg-[var(--state-safe)]/10 border-[var(--state-safe)]/50"
            : "bg-card border-border",
        )}
      >
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5 text-lg font-bold">
            {broadcasting ? (
              <RadioTowerIcon className="size-6 text-[var(--state-safe)] animate-pulse" />
            ) : (
              <RadioIcon className="size-6 text-muted-foreground" />
            )}
            GPS broadcast
            <span
              className={cn(
                "ml-1 text-sm font-bold uppercase tracking-wide rounded-md border px-2.5 py-1",
                broadcasting
                  ? "bg-[var(--state-safe)]/15 text-[var(--state-safe)] border-[var(--state-safe)]/40"
                  : "bg-muted text-muted-foreground border-border",
              )}
            >
              {broadcasting ? "ON" : "OFF"}
            </span>
          </div>
          {broadcasting ? (
            !gpsReachable ? (
              <div className="text-base font-medium text-[var(--anomaly-warn)]">
                Location not updating (offline) — resumes automatically when
                you&apos;re back online.
              </div>
            ) : (
              <div className="text-base text-muted-foreground">
                {lastReportAt
                  ? `Last sent ${lastReportAt.toLocaleTimeString()}.`
                  : "Waiting for first GPS fix…"}{" "}
                Keep the screen on.
              </div>
            )
          ) : (
            <div className="text-base text-muted-foreground">
              Turn on to share this van&apos;s location.
            </div>
          )}
          {error && (
            <div className="text-base font-medium text-destructive">Error: {error}</div>
          )}
        </div>
        <Button
          variant={broadcasting ? "outline" : "default"}
          size="lg"
          className="w-full text-lg min-h-14 sm:w-auto"
          onClick={() => setBroadcasting((v) => !v)}
        >
          {broadcasting ? "Stop GPS" : "Start GPS"}
        </Button>
      </div>

      <Input
        placeholder="Search this van's riders by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-5 text-base"
      />

      <ul className="space-y-4 mt-3">
        {roster
          .filter((r) =>
            search.trim()
              ? r.name.toLowerCase().includes(search.trim().toLowerCase())
              : true,
          )
          .map((r) => {
                const state = safeDayState(r.state);
                const presentation = STATE_PRESENTATION[state];
                const isPending = pendingStudents.has(r.studentId);
                const isQueued = outbox.pendingStudentIds.has(r.studentId);
                const isFailed = outbox.failedStudentIds.has(r.studentId);
                const canBoardAm =
                  r.direction !== "pm" &&
                  isLegalTransition(state, "van_boarded_am");
                const canCheckOut =
                  r.direction !== "am" &&
                  (isLegalTransition(state, "site_checked_out") ||
                    isLegalTransition(state, "van_offloaded_pm") ||
                    isLegalTransition(state, "parent_pickup"));
                // Boarded by mistake? Allow reverting while still on the van.
                const canCancelBoarding = state === "van_boarded_am";
                return (
                  <li
                    key={r.studentId}
                    className="rounded-2xl border bg-card overflow-hidden"
                    style={{
                      borderLeftWidth: 6,
                      borderLeftColor:
                        state === "not_started"
                          ? "var(--border)"
                          : `var(--state-${presentation.tone})`,
                    }}
                  >
                    <div className="p-4 space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="size-16 shrink-0 rounded-xl border bg-muted overflow-hidden flex items-center justify-center">
                          {r.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.photoUrl}
                              alt={r.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              no photo
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-2xl leading-tight truncate">
                            {r.name}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-base">
                            {r.colorHex && (
                              <span
                                className="inline-block w-5 h-5 rounded-full border ring-1 ring-border"
                                style={{ backgroundColor: r.colorHex }}
                                aria-hidden
                                title={r.colorName ?? undefined}
                              />
                            )}
                            <span className="font-medium">
                              {r.colorName ?? "no color"}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {r.wristbandCode}
                            </span>
                            <span className="text-muted-foreground">
                              {r.direction === "both"
                                ? "AM+PM"
                                : r.direction.toUpperCase()}
                            </span>
                            {isQueued && (
                              <span className="font-semibold text-[var(--anomaly-warn)] whitespace-nowrap">
                                ⏳ saved offline
                              </span>
                            )}
                            {isQueued && (
                              <button
                                type="button"
                                onClick={() => outbox.cancelForStudent(r.studentId)}
                                className="font-medium text-[var(--anomaly-warn)] underline underline-offset-2 whitespace-nowrap"
                              >
                                cancel
                              </button>
                            )}
                            {isFailed && (
                              <span className="font-semibold text-destructive whitespace-nowrap">
                                ⚠ didn&apos;t save — see banner
                              </span>
                            )}
                          </div>
                        </div>
                        <StateBadge state={state} size="md" />
                      </div>

                      {r.homeAddress || r.homeMapsUrl ? (
                        <div className="space-y-1">
                          {r.homeMapsUrl ? (
                            <a
                              href={r.homeMapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start gap-2 text-base font-medium text-primary underline-offset-2 hover:underline"
                            >
                              <MapPinIcon className="size-5 shrink-0 mt-0.5" />
                              <span>
                                {r.homeAddress ?? "Home location"}{" "}
                                <span className="text-sm font-normal">(tap to navigate)</span>
                              </span>
                            </a>
                          ) : (
                            <div className="flex items-start gap-2 text-base font-medium">
                              <MapPinIcon className="size-5 shrink-0 mt-0.5 text-muted-foreground" />
                              <span>{r.homeAddress}</span>
                            </div>
                          )}
                          {r.homeNotes && (
                            <div className="ml-7 text-sm text-muted-foreground">
                              📝 {r.homeNotes}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 text-base font-semibold text-[var(--anomaly-warn)]">
                          <MapPinIcon className="size-5 shrink-0 mt-0.5" />
                          <span>No home address on file — confirm pickup with the coordinator</span>
                        </div>
                      )}

                      <SafetyCallout
                        allergies={r.allergies}
                        medicalNotes={r.medicalNotes}
                        density="comfortable"
                      />

                      {(canBoardAm || canCheckOut || canCancelBoarding) && (
                        <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap">
                          {canBoardAm && (
                            <Button
                              size="lg"
                              className="w-full text-lg min-h-14 sm:w-auto"
                              disabled={isPending || isQueued}
                              onClick={() => requestVerify(r, "board_am")}
                            >
                              <BusIcon /> Boarded AM van
                            </Button>
                          )}
                          {canCheckOut && (
                            <Button
                              size="lg"
                              className="w-full text-lg min-h-14 sm:w-auto"
                              disabled={isPending || isQueued}
                              onClick={() => requestVerify(r, "drop_off")}
                            >
                              <HomeIcon /> Dropped off
                            </Button>
                          )}
                          {canCancelBoarding && (
                            <Button
                              variant="outline"
                              size="lg"
                              className="w-full text-base min-h-14 sm:w-auto"
                              disabled={isPending || isQueued}
                              onClick={() => cancelBoardingFor(r.studentId)}
                            >
                              ↩ Cancel boarding
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
        })}
      </ul>

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
        className="w-full max-w-md rounded-2xl bg-card border-2 border-primary p-5 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-1.5">
          <div
            id="photo-verify-title"
            className="text-sm uppercase tracking-wide font-medium text-muted-foreground"
          >
            Confirm the kid
          </div>
          <div className="text-3xl font-bold">{target.name}</div>
          <div className="text-base text-muted-foreground flex items-center justify-center gap-2 flex-wrap">
            {target.colorHex && (
              <span
                className="inline-block w-5 h-5 rounded-full border ring-1 ring-border"
                style={{ backgroundColor: target.colorHex }}
                aria-hidden
              />
            )}
            {target.colorName && <span className="font-medium">{target.colorName}</span>}
            <span className="font-mono">{target.wristbandCode}</span>
          </div>
        </div>

        <div className="mx-auto w-56 h-56 rounded-xl border bg-muted flex items-center justify-center overflow-hidden">
          {target.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={target.photoUrl}
              alt={target.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-base text-muted-foreground text-center px-3">
              No photo on file. Verify by name + wristband only.
            </span>
          )}
        </div>

        {target.homeAddress && (
          <div className="text-center text-base space-y-0.5">
            <div>
              <span className="text-muted-foreground">Home:</span>{" "}
              {target.homeMapsUrl ? (
                <a
                  href={target.homeMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary underline"
                >
                  {target.homeAddress}
                </a>
              ) : (
                <strong>{target.homeAddress}</strong>
              )}
            </div>
            {target.homeNotes && (
              <div className="text-sm text-muted-foreground">📝 {target.homeNotes}</div>
            )}
          </div>
        )}

        {(target.allergies || target.medicalNotes) && (
          <SafetyCallout
            allergies={target.allergies}
            medicalNotes={target.medicalNotes}
            density="comfortable"
          />
        )}

        <div className="flex gap-2.5 flex-col sm:flex-row">
          <Button
            size="lg"
            className="flex-1 text-lg min-h-14"
            onClick={onConfirm}
            disabled={!armed}
          >
            {armed
              ? `Yes — ${actionLabel}`
              : `Wait ${Math.ceil(remainingMs / 1000)}s…`}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="text-lg min-h-14"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
