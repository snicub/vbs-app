/**
 * Offline outbox — the correctness-critical core, kept PURE (no DOM, no
 * storage, no network) so the queue rules are exhaustively unit-testable. The
 * browser glue (localStorage + connectivity + the React hook) lives in
 * use-outbox.ts and is a thin shell over these functions.
 *
 * Safety model for a child-transport app: a queued action is NEVER silently
 * dropped. It either syncs (removed), is kept pending to retry (offline), or is
 * marked "failed" and surfaced for a human to resolve (the server permanently
 * rejected it — e.g. a stale action that's now an illegal transition).
 */

export type OutboxStatus = "pending" | "failed";

export type OutboxEntry = {
  id: string;
  /** Which server action to replay (maps to a sender in the hook). */
  kind: string;
  /** For the optimistic "saved offline" badge on a roster row. */
  studentId: string | null;
  /** Idempotency / double-tap key. A second enqueue with the same key is a no-op. */
  dedupKey: string;
  payload: unknown;
  /** When the user actually acted (ISO) — drives sync ORDER + the real event time. */
  capturedAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError: string | null;
};

/**
 * Validate a value loaded from localStorage is a well-formed entry. A corrupt
 * or old-schema blob (another tab, a half-write, a version skew) must be
 * discarded on load — otherwise an entry that's neither syncable nor countable
 * becomes a stuck "ghost" that silently never sends. Discarding a malformed
 * entry is safe: it could never have synced anyway.
 */
export function isOutboxEntry(x: unknown): x is OutboxEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.kind === "string" &&
    (e.studentId === null || typeof e.studentId === "string") &&
    typeof e.dedupKey === "string" &&
    "payload" in e &&
    typeof e.capturedAt === "string" &&
    typeof e.attempts === "number" &&
    (e.status === "pending" || e.status === "failed") &&
    (e.lastError === null || typeof e.lastError === "string")
  );
}

export type SendOutcome =
  | { outcome: "ok" }
  | { outcome: "rejected"; error: string }
  | { outcome: "network"; error: string };

export type Sender = (entry: OutboxEntry) => Promise<SendOutcome>;

export function makeEntry(input: {
  id: string;
  kind: string;
  studentId?: string | null;
  dedupKey: string;
  payload: unknown;
  capturedAt: string;
}): OutboxEntry {
  return {
    id: input.id,
    kind: input.kind,
    studentId: input.studentId ?? null,
    dedupKey: input.dedupKey,
    payload: input.payload,
    capturedAt: input.capturedAt,
    attempts: 0,
    status: "pending",
    lastError: null,
  };
}

/** Add an entry unless one with the same dedupKey is already queued (double-tap safe). */
export function enqueue(entries: OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  if (entries.some((e) => e.dedupKey === entry.dedupKey)) return entries;
  return [...entries, entry];
}

/** Pending entries to attempt, oldest first — preserves the real action order
 *  so the state machine sees board → ... → offload in sequence. */
export function syncable(entries: OutboxEntry[]): OutboxEntry[] {
  return entries
    .filter((e) => e.status === "pending")
    .slice()
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
}

export type DrainResult = {
  entries: OutboxEntry[];
  synced: number;
  failed: number;
  stoppedOffline: boolean;
};

/**
 * Drain pending entries in capture order. Successful sends are removed; a
 * permanent rejection is marked "failed" and kept (visible, never dropped); the
 * first network error stops the drain (we're offline — no point continuing) and
 * leaves the rest pending to retry later.
 */
export async function processQueue(
  entries: OutboxEntry[],
  send: Sender,
): Promise<DrainResult> {
  const removed = new Set<string>();
  const updated = new Map<string, OutboxEntry>();
  let synced = 0;
  let failed = 0;
  let stoppedOffline = false;

  for (const entry of syncable(entries)) {
    const result = await send(entry);
    if (result.outcome === "ok") {
      removed.add(entry.id);
      synced++;
    } else if (result.outcome === "rejected") {
      updated.set(entry.id, {
        ...entry,
        status: "failed",
        attempts: entry.attempts + 1,
        lastError: result.error,
      });
      failed++;
    } else {
      updated.set(entry.id, {
        ...entry,
        attempts: entry.attempts + 1,
        lastError: result.error,
      });
      stoppedOffline = true;
      break;
    }
  }

  const next = entries
    .filter((e) => !removed.has(e.id))
    .map((e) => updated.get(e.id) ?? e);

  return { entries: next, synced, failed, stoppedOffline };
}

/** Students with a still-pending action — drives the "saved offline" row badge. */
export function pendingStudentIds(entries: OutboxEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.status === "pending" && e.studentId) ids.add(e.studentId);
  }
  return ids;
}

/** Remove still-pending entries for a student — cancel a queued, not-yet-sent
 *  action (e.g. the driver tapped the wrong kid offline). Leaves failed entries
 *  alone; those need Retry / a coordinator, not a silent drop. */
export function removePendingForStudent(
  entries: OutboxEntry[],
  studentId: string,
): OutboxEntry[] {
  return entries.filter((e) => !(e.status === "pending" && e.studentId === studentId));
}

export function counts(entries: OutboxEntry[]): { pending: number; failed: number } {
  let pending = 0;
  let failed = 0;
  for (const e of entries) {
    if (e.status === "pending") pending++;
    else if (e.status === "failed") failed++;
  }
  return { pending, failed };
}
