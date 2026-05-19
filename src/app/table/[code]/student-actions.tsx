"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { submitEvent } from "@/server-actions/events";
import { smartCheckOut } from "@/server-actions/check-out";
import {
  EVENT_LABEL,
  type DayState,
  type EventType,
} from "@/lib/events/state-machine";
import type { UserRole } from "@/types/domain";
import { isCoordinator } from "@/lib/auth/roles";

/**
 * Three buttons for the table volunteer / coordinator workflow:
 *   - "Board AM van"   (only useful if state == not_started; usually fired
 *                       from /van/[vanId] by the aide, but provided here for
 *                       coordinator overrides + small-team setups.)
 *   - "Check in"       — fires site_checked_in regardless of whether the kid
 *                       came via van or parent dropoff.
 *   - "Check out"      — fires the chain of events to land in `home` state.
 *
 * Coordinator override panel below for everything else.
 */
export function StudentActions({
  studentId,
  eventDate,
  currentState,
  actorRole,
}: {
  studentId: string;
  eventDate: string;
  currentState: DayState;
  actorRole: UserRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideEvent, setOverrideEvent] = useState<EventType | "">("");
  const [overrideReason, setOverrideReason] = useState("");

  function fireSimple(event: EventType, label: string) {
    startTransition(async () => {
      const result = await submitEvent({ studentId, eventDate, eventType: event });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  function fireCheckOut() {
    startTransition(async () => {
      const result = await smartCheckOut({ studentId, eventDate });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked out — home");
      router.refresh();
    });
  }

  function fireOverride() {
    if (!overrideEvent || overrideReason.trim().length === 0) {
      toast.error("Pick an event and write a reason.");
      return;
    }
    startTransition(async () => {
      const result = await submitEvent({
        studentId,
        eventDate,
        eventType: overrideEvent,
        overrideReason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${EVENT_LABEL[overrideEvent]} (override)`);
      setOverrideOpen(false);
      setOverrideEvent("");
      setOverrideReason("");
      router.refresh();
    });
  }

  const showBoardAm = currentState === "not_started";
  const showCheckIn =
    currentState === "not_started" ||
    currentState === "van_boarded_am" ||
    currentState === "arrived_at_site";
  const showCheckOut =
    currentState === "site_checked_in" ||
    currentState === "site_checked_out" ||
    currentState === "van_boarded_pm";

  const allDone = currentState === "home" || currentState === "marked_no_show";

  return (
    <div className="space-y-4">
      {allDone ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          This student is in a terminal state ({currentState}). Use coordinator
          override below if you need to change anything.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {showBoardAm && (
            <Button size="lg" onClick={() => fireSimple("van_boarded_am", "Boarded AM van")} disabled={pending}>
              Boarded AM van
            </Button>
          )}
          {showCheckIn && (
            <Button size="lg" onClick={() => fireSimple("site_checked_in", "Checked in")} disabled={pending}>
              Check in
            </Button>
          )}
          {showCheckOut && (
            <Button size="lg" variant="secondary" onClick={fireCheckOut} disabled={pending}>
              Check out (delivered home)
            </Button>
          )}
        </div>
      )}

      {isCoordinator(actorRole) && (
        <div className="rounded-md border p-3">
          {!overrideOpen ? (
            <Button variant="outline" size="sm" onClick={() => setOverrideOpen(true)}>
              Coordinator override…
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Event to record</Label>
                <select
                  className="w-full rounded border bg-background h-9 px-2 text-sm"
                  value={overrideEvent}
                  onChange={(e) => setOverrideEvent(e.target.value as EventType)}
                >
                  <option value="">— select —</option>
                  {OVERRIDABLE.map((e) => (
                    <option key={e} value={e}>
                      {EVENT_LABEL[e]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Override reason (required)</Label>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain why this transition is necessary"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={fireOverride} disabled={pending}>
                  Submit override
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOverrideOpen(false);
                    setOverrideEvent("");
                    setOverrideReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const OVERRIDABLE: readonly EventType[] = [
  "site_checked_in",
  "site_checked_out",
  "parent_dropoff",
  "parent_pickup",
  "van_boarded_am",
  "van_offloaded_am",
  "van_boarded_pm",
  "van_offloaded_pm",
  "no_show",
];
