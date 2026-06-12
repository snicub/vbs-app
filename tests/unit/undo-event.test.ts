/**
 * Undo-event policy — the rules around who can undo and when. The actual
 * server action talks to Supabase; here we cover the authorization matrix
 * and the staleness check.
 */
import { describe, it, expect } from "vitest";
import type { UserRole } from "@/types/domain";

type EventRow = {
  id: string;
  actor_user_id: string | null;
  occurred_at: string;
  event_type: string;
  superseded_by_event_id: string | null;
};

function canUndo(
  session: { id: string; role: UserRole },
  event: EventRow,
  now: number = Date.now(),
): { ok: boolean; reason?: string } {
  if (event.superseded_by_event_id) return { ok: false, reason: "already undone" };
  if (event.event_type === "override") return { ok: false, reason: "override not undoable" };

  const isOwner = event.actor_user_id === session.id;
  const isCoord = session.role === "coordinator" || session.role === "admin";
  if (!isOwner && !isCoord) return { ok: false, reason: "not owner / not coord" };
  if (isCoord) return { ok: true };

  const ageMs = now - new Date(event.occurred_at).getTime();
  if (ageMs > 60_000) return { ok: false, reason: "too old" };
  return { ok: true };
}

const NOW = new Date("2026-06-23T15:00:00Z").getTime();

function event(over: Partial<EventRow>): EventRow {
  return {
    id: "e1",
    actor_user_id: "user1",
    occurred_at: new Date(NOW - 1000).toISOString(),
    event_type: "site_checked_in",
    superseded_by_event_id: null,
    ...over,
  };
}

describe("undo-event authorization", () => {
  it("allows the owner to undo within 60 seconds", () => {
    expect(canUndo({ id: "user1", role: "table_volunteer" }, event({}), NOW).ok).toBe(true);
  });

  it("blocks the owner after 60 seconds", () => {
    expect(
      canUndo(
        { id: "user1", role: "table_volunteer" },
        event({ occurred_at: new Date(NOW - 70_000).toISOString() }),
        NOW,
      ).ok,
    ).toBe(false);
  });

  it("allows a coordinator to undo anytime within the day", () => {
    const result = canUndo(
      { id: "user2", role: "coordinator" },
      event({ occurred_at: new Date(NOW - 60 * 60 * 1000).toISOString() }),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("blocks a different non-coord user", () => {
    expect(
      canUndo({ id: "user2", role: "table_volunteer" }, event({}), NOW).ok,
    ).toBe(false);
  });

  it("blocks an already-superseded event", () => {
    const result = canUndo(
      { id: "user1", role: "coordinator" },
      event({ superseded_by_event_id: "e2" }),
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already undone");
  });

  it("blocks an override event from being undone", () => {
    expect(
      canUndo(
        { id: "user1", role: "coordinator" },
        event({ event_type: "override" }),
        NOW,
      ).ok,
    ).toBe(false);
  });
});
