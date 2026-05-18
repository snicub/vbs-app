"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { submitEvent } from "@/server-actions/events";
import {
  EVENT_LABEL,
  legalNextEvents,
  type DayState,
  type EventType,
} from "@/lib/events/state-machine";
import type { UserRole } from "@/types/domain";
import { isCoordinator } from "@/lib/auth/roles";

/**
 * Renders the event-write surface for one student on the table page.
 * Shows only the events the table volunteer is realistically going to fire:
 * site_checked_in, site_checked_out, parent_dropoff, parent_pickup.
 * Coordinators get a full override surface.
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

  const tableActions = relevantTableActions(currentState);
  const legal = legalNextEvents(currentState);

  function fire(event: EventType, overrideReason?: string) {
    startTransition(async () => {
      const result = await submitEvent({
        studentId,
        eventDate,
        eventType: event,
        overrideReason: overrideReason ?? null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.wasOverride
          ? `${EVENT_LABEL[event]} (override)`
          : EVENT_LABEL[event],
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {tableActions.map((event) => (
          <Button
            key={event}
            size="lg"
            onClick={() => fire(event)}
            disabled={pending}
            variant={legal.includes(event) ? "default" : "outline"}
          >
            {EVENT_LABEL[event]}
          </Button>
        ))}
      </div>

      {isCoordinator(actorRole) && (
        <div className="rounded-md border p-3">
          {!overrideOpen ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOverrideOpen(true)}
            >
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
                  {ALL_OVERRIDABLE_EVENTS.map((e) => (
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
                <Button
                  onClick={() => {
                    if (!overrideEvent || overrideReason.trim().length === 0) {
                      toast.error("Pick an event and write a reason.");
                      return;
                    }
                    fire(overrideEvent, overrideReason);
                    setOverrideOpen(false);
                    setOverrideEvent("");
                    setOverrideReason("");
                  }}
                  disabled={pending}
                >
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

const ALL_OVERRIDABLE_EVENTS: readonly EventType[] = [
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

function relevantTableActions(state: DayState): EventType[] {
  // Table volunteers care about check-in / check-out + parent dropoff/pickup.
  // The state determines which subset is the natural next step.
  switch (state) {
    case "arrived_at_site":
      return ["site_checked_in", "parent_dropoff"];
    case "not_started":
      return ["parent_dropoff", "site_checked_in"];
    case "site_checked_in":
      return ["site_checked_out"];
    case "site_checked_out":
      return ["parent_pickup"];
    default:
      return ["site_checked_in", "site_checked_out", "parent_dropoff", "parent_pickup"];
  }
}
