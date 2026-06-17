/**
 * Undo-event policy — who can undo and when. These assertions exercise the REAL
 * decision function (`canUndo` in src/lib/events/undo.ts) that the undoEvent
 * server action calls, so the test can't drift from the action's behavior. The
 * action only adds the DB lookups (`now`, `hasNewerEvents`) on top.
 */
import { describe, it, expect } from "vitest";
import { canUndo, type UndoableEvent } from "@/lib/events/undo";
import type { UserRole } from "@/types/domain";

const NOW = new Date("2026-06-23T15:00:00Z").getTime();

function ev(over: Partial<UndoableEvent>): UndoableEvent {
  return {
    eventType: "site_checked_in",
    actorUserId: "user1",
    occurredAt: new Date(NOW - 1000).toISOString(),
    supersededByEventId: null,
    ...over,
  };
}

const ctx = (over?: Partial<{ now: number; hasNewerEvents: boolean }>) => ({
  now: NOW,
  hasNewerEvents: false,
  ...over,
});

const owner = (role: UserRole) => ({ id: "user1", role });
const other = (role: UserRole) => ({ id: "user2", role });

describe("canUndo — ownership + window", () => {
  it("allows the owner to undo within 60 seconds", () => {
    expect(canUndo(ev({}), owner("table_volunteer"), ctx()).ok).toBe(true);
  });

  it("blocks the owner after 60 seconds", () => {
    const r = canUndo(
      ev({ occurredAt: new Date(NOW - 70_000).toISOString() }),
      owner("table_volunteer"),
      ctx(),
    );
    expect(r).toEqual({ ok: false, error: "Too late to undo — ask a coordinator to override" });
  });

  it("allows a coordinator to undo well past the window", () => {
    expect(
      canUndo(ev({ occurredAt: new Date(NOW - 60 * 60 * 1000).toISOString() }), other("coordinator"), ctx())
        .ok,
    ).toBe(true);
  });

  it("blocks a different non-coordinator user", () => {
    expect(canUndo(ev({}), other("table_volunteer"), ctx()).ok).toBe(false);
  });
});

describe("canUndo — terminal cases", () => {
  it("blocks an already-superseded event", () => {
    expect(canUndo(ev({ supersededByEventId: "e2" }), owner("coordinator"), ctx())).toEqual({
      ok: false,
      error: "This event was already undone",
    });
  });

  it("blocks undoing an override event", () => {
    expect(canUndo(ev({ eventType: "override" }), owner("coordinator"), ctx()).ok).toBe(false);
  });
});

describe("canUndo — no_show is coordinator-only (rule the old test missed)", () => {
  it("blocks a non-coordinator from reversing a no_show even as the owner within the window", () => {
    expect(canUndo(ev({ eventType: "no_show" }), owner("table_volunteer"), ctx())).toEqual({
      ok: false,
      error: "Only a coordinator can reverse a no-show",
    });
  });

  it("allows a coordinator to reverse a no_show", () => {
    expect(canUndo(ev({ eventType: "no_show" }), other("coordinator"), ctx()).ok).toBe(true);
  });
});

describe("canUndo — newer-events guard (rule the old test missed)", () => {
  it("blocks a non-coordinator when newer events exist", () => {
    expect(canUndo(ev({}), owner("table_volunteer"), ctx({ hasNewerEvents: true }))).toEqual({
      ok: false,
      error: "Newer events exist — ask a coordinator to override instead",
    });
  });

  it("does NOT block a coordinator when newer events exist", () => {
    expect(canUndo(ev({}), other("coordinator"), ctx({ hasNewerEvents: true })).ok).toBe(true);
  });

  it("the too-late check takes precedence over the newer-events check", () => {
    const r = canUndo(
      ev({ occurredAt: new Date(NOW - 70_000).toISOString() }),
      owner("table_volunteer"),
      ctx({ hasNewerEvents: true }),
    );
    expect(r).toEqual({ ok: false, error: "Too late to undo — ask a coordinator to override" });
  });
});
