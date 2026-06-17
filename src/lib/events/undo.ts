import type { UserRole } from "@/types/domain";

export type UndoableEvent = {
  eventType: string;
  actorUserId: string | null;
  /** ISO timestamp. */
  occurredAt: string;
  supersededByEventId: string | null;
};

export type UndoActor = { id: string; role: UserRole };

export type UndoDecision = { ok: true } | { ok: false; error: string };

export const UNDO_WINDOW_MS = 60_000;

/**
 * Decide whether an event may be undone (superseded by an override). This is the
 * single source of truth for the undo rules — the `undoEvent` server action
 * supplies the DB-derived inputs (`now`, `hasNewerEvents`) and otherwise just
 * applies this decision, so the policy can't drift between the action and its
 * tests.
 *
 * Rules, in order:
 *  - already superseded → no
 *  - override events → no (record a new override instead)
 *  - must be the actor who recorded it, OR a coordinator/admin
 *  - a no_show may only be reversed by a coordinator
 *  - a non-coordinator may only undo within 60s, and only if no newer
 *    (non-superseded, non-override) events exist for that student/day
 *  - coordinators/admins bypass the 60s window + newer-events guard
 */
export function canUndo(
  event: UndoableEvent,
  actor: UndoActor,
  ctx: { now: number; hasNewerEvents: boolean },
): UndoDecision {
  if (event.supersededByEventId) {
    return { ok: false, error: "This event was already undone" };
  }
  if (event.eventType === "override") {
    return { ok: false, error: "Override events can't be undone — record a new override" };
  }

  const isCoord = actor.role === "coordinator" || actor.role === "admin";
  const isOwner = event.actorUserId === actor.id;
  if (!isOwner && !isCoord) {
    return { ok: false, error: "You can only undo your own events" };
  }
  if (event.eventType === "no_show" && !isCoord) {
    return { ok: false, error: "Only a coordinator can reverse a no-show" };
  }
  if (!isCoord) {
    if (ctx.now - new Date(event.occurredAt).getTime() > UNDO_WINDOW_MS) {
      return { ok: false, error: "Too late to undo — ask a coordinator to override" };
    }
    if (ctx.hasNewerEvents) {
      return { ok: false, error: "Newer events exist — ask a coordinator to override instead" };
    }
  }
  return { ok: true };
}
