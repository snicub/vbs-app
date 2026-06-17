import { describe, it, expect } from "vitest";
import {
  makeEntry,
  enqueue,
  syncable,
  processQueue,
  pendingStudentIds,
  counts,
  removePendingForStudent,
  type OutboxEntry,
} from "@/lib/offline/outbox";

function e(over: Partial<OutboxEntry> & { id: string; dedupKey: string }): OutboxEntry {
  return {
    id: over.id,
    kind: over.kind ?? "submitEvent",
    studentId: over.studentId ?? null,
    dedupKey: over.dedupKey,
    payload: over.payload ?? {},
    capturedAt: over.capturedAt ?? "2026-06-23T08:00:00.000Z",
    attempts: over.attempts ?? 0,
    status: over.status ?? "pending",
    lastError: over.lastError ?? null,
  };
}

describe("makeEntry", () => {
  it("starts pending, zero attempts, no error", () => {
    const entry = makeEntry({ id: "1", kind: "submitEvent", dedupKey: "k1", payload: { a: 1 }, capturedAt: "t" });
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(0);
    expect(entry.lastError).toBeNull();
    expect(entry.studentId).toBeNull();
  });
});

describe("enqueue — double-tap / replay safety", () => {
  it("adds a new entry", () => {
    expect(enqueue([], e({ id: "1", dedupKey: "k1" }))).toHaveLength(1);
  });
  it("ignores a duplicate dedupKey (offline double-tap → one queued action)", () => {
    const first = enqueue([], e({ id: "1", dedupKey: "k1" }));
    const second = enqueue(first, e({ id: "2", dedupKey: "k1" }));
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe("1");
  });
});

describe("syncable", () => {
  it("returns only pending entries, oldest first", () => {
    const list = [
      e({ id: "b", dedupKey: "b", capturedAt: "2026-06-23T09:00:00Z" }),
      e({ id: "a", dedupKey: "a", capturedAt: "2026-06-23T08:00:00Z" }),
      e({ id: "f", dedupKey: "f", status: "failed", capturedAt: "2026-06-23T07:00:00Z" }),
    ];
    expect(syncable(list).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("processQueue", () => {
  it("removes every entry on success", async () => {
    const list = [e({ id: "1", dedupKey: "1" }), e({ id: "2", dedupKey: "2" })];
    const r = await processQueue(list, async () => ({ outcome: "ok" }));
    expect(r.entries).toHaveLength(0);
    expect(r.synced).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.stoppedOffline).toBe(false);
  });

  it("marks a permanent rejection failed and KEEPS it (never silently dropped)", async () => {
    const list = [e({ id: "1", dedupKey: "1" })];
    const r = await processQueue(list, async () => ({ outcome: "rejected", error: "illegal transition" }));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.status).toBe("failed");
    expect(r.entries[0]!.lastError).toBe("illegal transition");
    expect(r.entries[0]!.attempts).toBe(1);
    expect(r.failed).toBe(1);
  });

  it("on network error keeps the entry pending and STOPS (doesn't hammer offline)", async () => {
    const calls: string[] = [];
    const list = [
      e({ id: "1", dedupKey: "1", capturedAt: "2026-06-23T08:00:00Z" }),
      e({ id: "2", dedupKey: "2", capturedAt: "2026-06-23T08:01:00Z" }),
    ];
    const r = await processQueue(list, async (entry) => {
      calls.push(entry.id);
      return { outcome: "network", error: "offline" };
    });
    expect(calls).toEqual(["1"]); // stopped after the first network failure
    expect(r.stoppedOffline).toBe(true);
    expect(r.synced).toBe(0);
    expect(r.entries).toHaveLength(2);
    const first = r.entries.find((x) => x.id === "1")!;
    expect(first.status).toBe("pending");
    expect(first.attempts).toBe(1);
  });

  it("syncs in capture order (state-machine ordering is preserved)", async () => {
    const calls: string[] = [];
    const list = [
      e({ id: "late", dedupKey: "late", capturedAt: "2026-06-23T10:00:00Z" }),
      e({ id: "early", dedupKey: "early", capturedAt: "2026-06-23T08:00:00Z" }),
    ];
    await processQueue(list, async (entry) => {
      calls.push(entry.id);
      return { outcome: "ok" };
    });
    expect(calls).toEqual(["early", "late"]);
  });

  it("mix: one ok, then network stops the remainder (third never attempted)", async () => {
    const calls: string[] = [];
    const list = [
      e({ id: "1", dedupKey: "1", capturedAt: "2026-06-23T08:00:00Z" }),
      e({ id: "2", dedupKey: "2", capturedAt: "2026-06-23T08:01:00Z" }),
      e({ id: "3", dedupKey: "3", capturedAt: "2026-06-23T08:02:00Z" }),
    ];
    const r = await processQueue(list, async (entry) => {
      calls.push(entry.id);
      return entry.id === "1" ? { outcome: "ok" } : { outcome: "network", error: "x" };
    });
    expect(calls).toEqual(["1", "2"]);
    expect(r.synced).toBe(1);
    expect(r.entries.map((x) => x.id).sort()).toEqual(["2", "3"]);
    expect(r.stoppedOffline).toBe(true);
  });

  it("never re-attempts an already-failed entry", async () => {
    const calls: string[] = [];
    const list = [e({ id: "f", dedupKey: "f", status: "failed" }), e({ id: "p", dedupKey: "p" })];
    await processQueue(list, async (entry) => {
      calls.push(entry.id);
      return { outcome: "ok" };
    });
    expect(calls).toEqual(["p"]);
  });
});

describe("removePendingForStudent (cancel a queued action)", () => {
  it("removes pending entries for the student but keeps others + keeps failed", () => {
    const list = [
      e({ id: "1", dedupKey: "1", studentId: "s1" }),
      e({ id: "2", dedupKey: "2", studentId: "s2" }),
      e({ id: "3", dedupKey: "3", studentId: "s1", status: "failed" }),
    ];
    const r = removePendingForStudent(list, "s1");
    expect(r.map((x) => x.id)).toEqual(["2", "3"]);
  });
  it("no-op when the student has nothing pending", () => {
    const list = [e({ id: "1", dedupKey: "1", studentId: "s2" })];
    expect(removePendingForStudent(list, "s1")).toHaveLength(1);
  });
});

describe("pendingStudentIds + counts", () => {
  it("collects only pending entries' student ids", () => {
    const list = [
      e({ id: "1", dedupKey: "1", studentId: "s1" }),
      e({ id: "2", dedupKey: "2", studentId: "s2", status: "failed" }),
      e({ id: "3", dedupKey: "3", studentId: null }),
    ];
    expect(Array.from(pendingStudentIds(list))).toEqual(["s1"]);
  });
  it("counts pending vs failed", () => {
    const list = [
      e({ id: "1", dedupKey: "1" }),
      e({ id: "2", dedupKey: "2", status: "failed" }),
      e({ id: "3", dedupKey: "3" }),
    ];
    expect(counts(list)).toEqual({ pending: 2, failed: 1 });
  });
});
