"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  makeEntry,
  enqueue as enqueueEntry,
  processQueue,
  pendingStudentIds,
  removePendingForStudent,
  counts,
  type OutboxEntry,
  type SendOutcome,
} from "./outbox";
import { clientId } from "./uuid";

const STORAGE_KEY = "vbs.outbox.v1";
const SYNC_INTERVAL_MS = 20_000;

/** A server action that returns the app's standard {ok}/{ok,error} result. */
type Sender = (payload: unknown) => Promise<{ ok: boolean; error?: string }>;

function load(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Guard against corrupt / wrong-shape values (a half-written blob, another
    // tab stomping the key). A non-array would crash the queue logic later.
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

/** Returns false if the write didn't land (private mode / quota) so callers can
 *  warn instead of giving a false "saved offline" promise. */
function persist(entries: OutboxEntry[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

async function sendEntry(
  entry: OutboxEntry,
  senders: Record<string, Sender>,
): Promise<SendOutcome> {
  const fn = senders[entry.kind];
  if (!fn) return { outcome: "rejected", error: `Unknown action: ${entry.kind}` };
  try {
    const r = await fn(entry.payload);
    return r.ok ? { outcome: "ok" } : { outcome: "rejected", error: r.error ?? "Rejected by server" };
  } catch (err) {
    // A thrown error means the request never landed (offline / timeout) — retry.
    return { outcome: "network", error: err instanceof Error ? err.message : "Network error" };
  }
}

export type EnqueueInput = {
  kind: string;
  studentId?: string | null;
  dedupKey: string;
  payload: unknown;
};

/**
 * Store-and-forward outbox for the van flow. Queues actions in localStorage when
 * a write fails (offline) and replays them in order when connectivity returns.
 * Idempotency keys (events) + deterministic-key smart_checkout make replays safe.
 */
export function useOutbox(senders: Record<string, Sender>) {
  const router = useRouter();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const entriesRef = useRef<OutboxEntry[]>([]);
  const sendersRef = useRef(senders);
  sendersRef.current = senders;
  const syncingRef = useRef(false);

  const commit = useCallback((next: OutboxEntry[]): boolean => {
    entriesRef.current = next;
    const ok = persist(next);
    setEntries(next);
    return ok;
  }, []);

  const enqueue = useCallback(
    (input: EnqueueInput) => {
      const entry = makeEntry({
        id: clientId(),
        kind: input.kind,
        studentId: input.studentId ?? null,
        dedupKey: input.dedupKey,
        payload: input.payload,
        capturedAt: new Date().toISOString(),
      });
      const persisted = commit(enqueueEntry(entriesRef.current, entry));
      if (!persisted) {
        // The action is in memory but NOT on disk — it would be lost if the tab
        // is reaped. Never let "saved offline" be a false promise.
        toast.error("Couldn't save offline on this device — write it on paper as backup.");
      }
    },
    [commit],
  );

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (!entriesRef.current.some((e) => e.status === "pending")) return;
    syncingRef.current = true;
    try {
      const before = entriesRef.current;
      const result = await processQueue(before, (entry) => sendEntry(entry, sendersRef.current));

      // Reconcile against the LIVE ref, not `before`: an enqueue/retry that
      // happened during the await must survive. Drop the ids that synced, apply
      // status updates to the rest, and leave anything new untouched.
      const syncedIds = new Set(
        before.filter((e) => !result.entries.some((r) => r.id === e.id)).map((e) => e.id),
      );
      const updates = new Map(result.entries.map((e) => [e.id, e]));
      const reconciled = entriesRef.current
        .filter((e) => !syncedIds.has(e.id))
        .map((e) => updates.get(e.id) ?? e);
      commit(reconciled);

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} saved action${result.synced === 1 ? "" : "s"}`);
        router.refresh();
      }
      if (result.failed > 0) {
        toast.error(
          `${result.failed} saved action${result.failed === 1 ? "" : "s"} couldn't sync — tap Retry`,
        );
      }
    } finally {
      syncingRef.current = false;
    }
  }, [commit, router]);

  const retryFailed = useCallback(() => {
    const next = entriesRef.current.map((e) =>
      e.status === "failed" ? { ...e, status: "pending" as const, lastError: null } : e,
    );
    commit(next);
    void sync();
  }, [commit, sync]);

  // Cancel a queued, not-yet-sent action (driver tapped the wrong kid offline).
  const cancelForStudent = useCallback(
    (studentId: string) => {
      commit(removePendingForStudent(entriesRef.current, studentId));
    },
    [commit],
  );

  useEffect(() => {
    const loaded = load();
    entriesRef.current = loaded;
    setEntries(loaded);
    setIsOnline(navigator.onLine);

    function onOnline() {
      setIsOnline(true);
      void sync();
    }
    function onOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void sync();
    const id = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(id);
    };
  }, [sync]);

  const { pending, failed: failedCount } = counts(entries);
  const failedStudentIds = new Set(
    entries.filter((e) => e.status === "failed" && e.studentId).map((e) => e.studentId as string),
  );

  return {
    isOnline,
    pending,
    failedCount,
    failed: entries.filter((e) => e.status === "failed"),
    pendingStudentIds: pendingStudentIds(entries),
    failedStudentIds,
    enqueue,
    syncNow: sync,
    retryFailed,
    cancelForStudent,
  };
}
