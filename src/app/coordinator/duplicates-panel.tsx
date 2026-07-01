"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveStudent } from "@/server-actions/students";
import type { DupGroup } from "@/lib/coordinator/duplicates";

// "Not a duplicate" is a soft dismissal of a hint, so it lives in localStorage
// (per browser) — no DB/migration. Worst case it re-appears on another device.
const DISMISS_KEY = "vbs.dismissedDuplicateNames";

export function DuplicatesPanel({ groups }: { groups: DupGroup[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Before mount, render every group so the client's first paint matches the
  // server's (no hydration mismatch); after mount, hide dismissed groups.
  const visible = ready ? groups.filter((g) => !dismissed.has(g.key)) : groups;
  if (visible.length === 0) return null;

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
    toast.success("Marked as not a duplicate");
  }

  function remove(studentId: string) {
    setBusyId(studentId);
    setConfirmId(null);
    startTransition(async () => {
      const res = await archiveStudent({ studentId });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed from roster — restore under Students → Archived");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border-2 border-[var(--anomaly-warn)]/30 bg-[var(--anomaly-warn)]/5 p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-1">
        <CopyIcon className="size-5 text-[var(--anomaly-warn)]" aria-hidden />
        <h2 className="font-semibold text-sm sm:text-base">
          Possible duplicate names ({visible.length})
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        These kids share a name — tap a code to verify they aren&apos;t the same child registered
        twice. Two different kids CAN share a name; use <strong>Not a duplicate</strong> if they&apos;re
        different, or <strong>Remove duplicate</strong> on the extra registration.
      </p>
      <ul className="space-y-2">
        {visible.map((g) => (
          <li key={g.key} className="rounded-lg bg-card border px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{g.display}</div>
              <button
                type="button"
                onClick={() => dismiss(g.key)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground whitespace-nowrap"
              >
                Not a duplicate
              </button>
            </div>
            <ul className="mt-1.5 divide-y">
              {g.members.map((mem) => (
                <li key={mem.studentId} className="flex items-center justify-between gap-2 py-1.5">
                  <Link
                    href={`/table/${mem.wristbandCode}`}
                    className="text-xs font-mono text-primary hover:underline"
                  >
                    {mem.wristbandCode}
                  </Link>
                  {confirmId === mem.studentId ? (
                    <span className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="min-h-9 text-xs"
                        disabled={pending}
                        onClick={() => remove(mem.studentId)}
                      >
                        Confirm remove
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9 text-xs"
                        onClick={() => setConfirmId(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-9 text-xs"
                      disabled={pending && busyId === mem.studentId}
                      onClick={() => setConfirmId(mem.studentId)}
                    >
                      {busyId === mem.studentId ? "Removing…" : "Remove duplicate"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
