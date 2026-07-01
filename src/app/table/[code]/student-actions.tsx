"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { submitEvent, undoEvent } from "@/server-actions/events";
import { smartCheckOut, type PickupMetadata } from "@/server-actions/check-out";
import {
  EVENT_LABEL,
  isLegalTransition,
  type DayState,
  type EventType,
} from "@/lib/events/state-machine";
import { STATE_PRESENTATION } from "@/lib/state-presentation";
import type { UserRole } from "@/types/domain";
import { isCoordinator } from "@/lib/auth/roles";
import { buildPickupOptions, type PickupOption } from "@/lib/checkin/pickup-options";
import { offersPmVanCheckout } from "@/lib/checkin/pm-van";
import {
  BusIcon,
  CheckIcon,
  HomeIcon,
  OctagonXIcon,
  UserCheckIcon,
} from "lucide-react";

/**
 * Action surface for a single student on the table check-in page.
 *
 * Action visibility is driven by `isLegalTransition()` — never offer a
 * button that would round-trip to a "illegal transition" error. The only
 * way past the state machine is the coordinator override panel below.
 *
 * Parent-pickup now requires the volunteer to identify WHO picked up.
 * Eligible: primary guardian, secondary guardians, the family's emergency
 * contact, authorized_pickup_persons. The volunteer can also type in an
 * unlisted name — that fires an incident for coordinator review.
 */
export function StudentActions({
  studentId,
  eventDate,
  currentState,
  actorRole,
  mode,
  primaryGuardianName,
  emergencyContact,
  guardians,
  authorizedPickup,
  pmVanAvailable = true,
  stayOnPage = false,
}: {
  studentId: string;
  eventDate: string;
  currentState: DayState;
  actorRole: UserRole;
  /** Transport mode for the day. Used to decide whether to expose the
   *  "send home on van" button — kids in parent_pickup_only or parent_both
   *  never board the PM van so the van button is hidden for them. */
  mode: "van" | "parent_dropoff_only" | "parent_pickup_only" | "parent_both" | null;
  primaryGuardianName: string | null;
  emergencyContact: { name: string; relationship: string | null } | null;
  guardians: { fullName: string; relationship: string | null }[];
  authorizedPickup: { id: string; fullName: string; relationship: string | null }[];
  /** Whether a real PM van is assigned for this kid's afternoon leg. Gates the
   *  "Send home on van" button so an un-routed van kid (no van) can't be
   *  checked out onto a fabricated van chain. Defaults true (the table page,
   *  which doesn't fetch the derived van, keeps its existing behavior). */
  pmVanAvailable?: boolean;
  /** On the single-student table page each action returns to /table to scan the
   *  next kid. On a multi-student list (the van-group page) we stay put and just
   *  refresh, so the coordinator can keep working down the list. */
  stayOnPage?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Pickup picker state — opens when the volunteer taps the parent-pickup
  // button. We do NOT fire smart_checkout until a person is selected.
  const [pickupOpen, setPickupOpen] = useState(false);
  const [pickupSelection, setPickupSelection] = useState<string>("");
  const [unlistedName, setUnlistedName] = useState("");
  const [unlistedRelationship, setUnlistedRelationship] = useState("");
  const [unlistedNotes, setUnlistedNotes] = useState("");

  function fireSimple(event: EventType, label: string) {
    startTransition(async () => {
      const result = await submitEvent({ studentId, eventDate, eventType: event });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // No-show is a destructive terminal action — don't offer one-tap undo;
      // require coordinator override to reverse (per spec).
      if (event === "no_show") {
        toast.success(label);
      } else {
        showUndoToast(label, result.eventId);
      }
      router.refresh();
      if (!stayOnPage) router.push("/table");
    });
  }

  function showUndoToast(label: string, eventId: string) {
    toast.success(label, {
      duration: 5_000,
      action: {
        label: "Undo",
        onClick: () => {
          void undoEvent({ eventId }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Reverted");
              router.refresh();
            }
          });
        },
      },
    });
  }

  function fireCheckOut(
    pmPath: "auto" | "parent" | "van",
    label: string,
    pickup?: PickupMetadata,
  ) {
    startTransition(async () => {
      const result = await smartCheckOut({ studentId, eventDate, pmPath, pickup });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
      if (!stayOnPage) router.push("/table");
    });
  }

  // A kid marked no-show who then shows up (parent dropped them off) must still
  // be checkable in — being present is never a coordinator-only event. no_show is
  // terminal in the state machine, so this rides the coordinator override path
  // with an automatic reason instead of making staff dig into the override panel.
  function fireArrivedAfterNoShow() {
    startTransition(async () => {
      const result = await submitEvent({
        studentId,
        eventDate,
        eventType: "parent_dropoff",
        overrideReason: "Marked no-show but arrived — parent dropped off",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked in — parent dropped off");
      router.refresh();
      if (!stayOnPage) router.push("/table");
    });
  }

  // One-tap override: fire the chosen event past the state machine with an
  // automatic reason (record_event still requires a reason to be present, and
  // it's logged) — no free-text box to slow the coordinator down.
  function fireOverrideEvent(event: EventType) {
    startTransition(async () => {
      const result = await submitEvent({
        studentId,
        eventDate,
        eventType: event,
        overrideReason: `Coordinator override — ${EVENT_LABEL[event]}`,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${EVENT_LABEL[event]} (override)`);
      setOverrideOpen(false);
      router.refresh();
    });
  }

  // Pickup-picker options (dedup'd by name) — shared pure builder, pinned by
  // pickup-options.test.ts.
  const pickupOptions: PickupOption[] = buildPickupOptions({
    primaryGuardianName,
    emergencyContact,
    guardians,
    authorizedPickup,
  });

  function submitPickup() {
    if (pickupSelection === "__unlisted__") {
      const name = unlistedName.trim();
      if (!name) {
        toast.error("Enter the person's name.");
        return;
      }
      const meta: PickupMetadata = {
        authorizedPickupPersonId: null,
        name,
        relationship: unlistedRelationship.trim() || null,
        isEmergencyContact: false,
        wasUnlisted: true,
        notes: unlistedNotes.trim() || null,
      };
      setPickupOpen(false);
      resetPickupForm();
      fireCheckOut("parent", `Released to ${name} (unlisted)`, meta);
      return;
    }
    const selected = pickupOptions.find((o, i) => `${i}` === pickupSelection);
    if (!selected) {
      toast.error("Pick who is here.");
      return;
    }
    const meta: PickupMetadata = {
      authorizedPickupPersonId: selected.id,
      name: selected.fullName,
      relationship: selected.relationship,
      isEmergencyContact: selected.kind === "emergency",
      wasUnlisted: false,
      notes: null,
    };
    setPickupOpen(false);
    resetPickupForm();
    fireCheckOut("parent", `Released to ${selected.fullName}`, meta);
  }

  function resetPickupForm() {
    setPickupSelection("");
    setUnlistedName("");
    setUnlistedRelationship("");
    setUnlistedNotes("");
  }

  // Drive available actions from the state machine — never offer an event
  // that would round-trip to an "illegal transition" error.
  const canBoardAm     = isLegalTransition(currentState, "van_boarded_am");
  const canParentDrop  = isLegalTransition(currentState, "parent_dropoff");
  const canCheckIn     = isLegalTransition(currentState, "site_checked_in");
  const canCheckOut    =
    isLegalTransition(currentState, "site_checked_out") ||
    isLegalTransition(currentState, "parent_pickup") ||
    isLegalTransition(currentState, "van_offloaded_pm");
  const canNoShow      = isLegalTransition(currentState, "no_show");

  // Kids whose mode includes a PM van get the "send home on van" button.
  // Kids whose mode is parent-only get only the "parent here now" button.
  // Once they're already on the PM van (van_boarded_pm), there's nothing
  // to choose — finishing the chain is the only option.
  const usesPmVan = offersPmVanCheckout(mode, pmVanAvailable);
  const inVanPmChain = currentState === "van_boarded_pm";

  const allDone = currentState === "home" || currentState === "marked_no_show";
  const stateLabel = STATE_PRESENTATION[currentState].label;

  return (
    <div className="space-y-4">
      {allDone ? (
        <div className="space-y-3">
          {currentState === "marked_no_show" && isCoordinator(actorRole) && (
            <Button
              size="lg"
              onClick={fireArrivedAfterNoShow}
              disabled={pending}
              className="w-full"
            >
              <UserCheckIcon /> They&apos;re here — parent dropped off
            </Button>
          )}
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            This student is in a terminal state ({stateLabel}).{" "}
            {isCoordinator(actorRole)
              ? "Use the button above (if they showed up) or the coordinator override below."
              : "Ask a coordinator to fix this."}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {canBoardAm && (
            <Button
              size="lg"
              onClick={() => fireSimple("van_boarded_am", "Boarded AM van")}
              disabled={pending}
            >
              <BusIcon /> Boarded AM van
            </Button>
          )}
          {canParentDrop && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => fireSimple("parent_dropoff", "Parent dropoff")}
              disabled={pending}
            >
              <UserCheckIcon /> Parent dropoff
            </Button>
          )}
          {canCheckIn && (
            <Button
              size="lg"
              onClick={() => fireSimple("site_checked_in", "Checked in")}
              disabled={pending}
            >
              <CheckIcon /> Check in
            </Button>
          )}
          {canCheckOut && inVanPmChain && (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => fireCheckOut("auto", "Off the van — home")}
              disabled={pending}
              className="sm:col-span-2"
            >
              <HomeIcon /> Off the van — home
            </Button>
          )}
          {canCheckOut && !inVanPmChain && (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setPickupOpen(true)}
              disabled={pending}
              className={usesPmVan ? "" : "sm:col-span-2"}
            >
              <UserCheckIcon /> Parent here — going home now
            </Button>
          )}
          {canCheckOut && !inVanPmChain && usesPmVan && (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => fireCheckOut("van", "Boarded PM van — home")}
              disabled={pending}
            >
              <BusIcon /> Send home on van
            </Button>
          )}
          {canNoShow && !confirmingNoShow && (
            <Button
              size="lg"
              variant="destructive"
              onClick={() => setConfirmingNoShow(true)}
              disabled={pending}
              className="sm:col-span-2"
            >
              <OctagonXIcon /> Mark no-show
            </Button>
          )}
          {canNoShow && confirmingNoShow && (
            <div className="sm:col-span-2 flex gap-2">
              <Button
                size="lg"
                variant="destructive"
                onClick={() => {
                  setConfirmingNoShow(false);
                  fireSimple("no_show", "Marked no-show");
                }}
                disabled={pending}
                className="flex-1"
              >
                <OctagonXIcon /> Confirm no-show
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setConfirmingNoShow(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Pickup-person picker — shown when volunteer taps "Parent here". */}
      {pickupOpen && (
        <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="font-semibold">Who is picking up?</div>
          <p className="text-xs text-muted-foreground">
            Confirm the person standing here. This is recorded.
          </p>
          <div className="space-y-2">
            {pickupOptions.map((opt, i) => (
              <label
                key={`${opt.fullName}-${i}`}
                className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 cursor-pointer hover:bg-muted/40 min-h-12"
              >
                <input
                  type="radio"
                  name="pickup-person"
                  value={`${i}`}
                  checked={pickupSelection === `${i}`}
                  onChange={(e) => setPickupSelection(e.target.value)}
                  className="mt-1 size-4 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{opt.fullName}</div>
                  <div className="text-xs text-muted-foreground">
                    {opt.relationship ?? ""}
                    {opt.kind === "primary" && " · primary guardian"}
                    {opt.kind === "emergency" && " · emergency contact"}
                    {opt.kind === "auth" && " · authorized pickup"}
                    {opt.kind === "guardian" && opt.relationship === null && "guardian"}
                  </div>
                </div>
              </label>
            ))}
            <label className="flex items-start gap-3 rounded-lg border-2 border-dashed bg-card px-3 py-2.5 cursor-pointer hover:bg-muted/40 min-h-12">
              <input
                type="radio"
                name="pickup-person"
                value="__unlisted__"
                checked={pickupSelection === "__unlisted__"}
                onChange={(e) => setPickupSelection(e.target.value)}
                className="mt-1 size-4 accent-primary"
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">Someone else (not on file)</div>
                <div className="text-xs text-muted-foreground">
                  Coordinator will be alerted.
                </div>
              </div>
            </label>
          </div>

          {pickupSelection === "__unlisted__" && (
            <div className="space-y-2 rounded-lg bg-card p-3 border">
              <div className="space-y-1.5">
                <Label htmlFor="unlisted-name">Full name</Label>
                <Input
                  id="unlisted-name"
                  value={unlistedName}
                  onChange={(e) => setUnlistedName(e.target.value)}
                  placeholder="e.g. Aunt Sarah Jones"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unlisted-relationship">
                  Relationship (optional)
                </Label>
                <Input
                  id="unlisted-relationship"
                  value={unlistedRelationship}
                  onChange={(e) => setUnlistedRelationship(e.target.value)}
                  placeholder="aunt, neighbor, family friend, etc."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unlisted-notes">
                  Notes (e.g. parent called and OK&apos;d this)
                </Label>
                <Textarea
                  id="unlisted-notes"
                  rows={2}
                  value={unlistedNotes}
                  onChange={(e) => setUnlistedNotes(e.target.value)}
                  placeholder="Parent called at 2:30pm. Showed ID."
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={submitPickup} disabled={pending || !pickupSelection}>
              <UserCheckIcon /> Release student
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPickupOpen(false);
                resetPickupForm();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isCoordinator(actorRole) && (
        <div className="rounded-lg border p-3">
          {!overrideOpen ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOverrideOpen(true)}
            >
              Coordinator override…
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Force a status — tap one</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setOverrideOpen(false)}
                >
                  Cancel
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {OVERRIDABLE.map((e) => (
                  <Button
                    key={e}
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => fireOverrideEvent(e)}
                  >
                    {EVENT_LABEL[e]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Logged as a coordinator override.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// parent_pickup is deliberately NOT overridable: the override path routes
// through record_event, which skips the restricted "do-not-release" block and
// the who-picked-up requirement (the CHECK exempts override rows). Coordinators
// release via the normal pickup picker (smartCheckOut), which enforces both.
const OVERRIDABLE: readonly EventType[] = [
  "site_checked_in",
  "site_checked_out",
  "parent_dropoff",
  "van_boarded_am",
  "van_offloaded_am",
  "van_boarded_pm",
  "van_offloaded_pm",
  "no_show",
];
