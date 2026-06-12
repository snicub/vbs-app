"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AnomalyBadge, StateBadge } from "@/components/state-badge";
import { toast } from "sonner";
import { closeoutDay, reopenDay } from "@/server-actions/closeout";
import type { AnomalyStudent, NonTerminalStudent } from "./page";

export function CloseoutForm({
  eventDate,
  anomalyStudents,
  nonTerminalStudents,
  existing,
}: {
  eventDate: string;
  anomalyStudents: AnomalyStudent[];
  nonTerminalStudents: NonTerminalStudent[];
  existing: { closed_at: string; notes: string | null } | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [confirmingClose, setConfirmingClose] = useState(false);

  function close() {
    startTransition(async () => {
      const result = await closeoutDay({ eventDate, notes });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Closed");
        router.push("/coordinator");
      }
    });
  }

  function reopen() {
    startTransition(async () => {
      const result = await reopenDay({ eventDate });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Reopened");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Non-terminal state warning */}
      {nonTerminalStudents.length > 0 && (
        <div className="rounded-lg border border-[var(--anomaly-warn)]/40 bg-[var(--anomaly-warn)]/8 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--anomaly-warn)]">
              {nonTerminalStudents.length}{" "}
              {nonTerminalStudents.length === 1 ? "student is" : "students are"} not yet home
            </span>
          </div>
          <p className="text-xs text-[var(--anomaly-warn)]/80">
            These students have not reached a terminal state (Home or No-show).
            You can still close out, but verify their status first.
          </p>
          <ul className="divide-y divide-[var(--anomaly-warn)]/15">
            {nonTerminalStudents.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-3 py-2.5 min-h-11">
                <Link
                  href={`/table/${s.wristbandCode}`}
                  className="text-sm font-medium hover:underline"
                >
                  {s.displayName}
                </Link>
                <StateBadge state={s.state} size="sm" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Anomaly list */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        {anomalyStudents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No anomalies open right now.</p>
        ) : (
          <>
            <p className="text-sm font-medium">
              {anomalyStudents.length}{" "}
              {anomalyStudents.length === 1 ? "student has" : "students have"} open anomalies.
              Their state will be snapshotted into the closeout record.
            </p>
            <ul className="divide-y divide-border">
              {anomalyStudents.map((s) => (
                <li key={s.studentId} className="py-2.5 space-y-1.5">
                  <Link
                    href={`/table/${s.wristbandCode}`}
                    className="text-sm font-medium hover:underline inline-flex items-center min-h-9"
                  >
                    {s.displayName}
                  </Link>
                  <div className="flex flex-wrap gap-1.5">
                    {s.anomalies.map((kind) => (
                      <AnomalyBadge key={kind} kind={kind} size="sm" />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the next-day staff should know"
        />
      </div>
      {existing ? (
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            Closed {new Date(existing.closed_at).toLocaleString()}
          </div>
          <Button variant="outline" onClick={reopen} disabled={pending}>
            Reopen
          </Button>
        </div>
      ) : nonTerminalStudents.length > 0 && !confirmingClose ? (
        <Button
          onClick={() => setConfirmingClose(true)}
          disabled={pending}
        >
          Mark closed
        </Button>
      ) : nonTerminalStudents.length > 0 && confirmingClose ? (
        <div className="flex gap-2">
          <Button variant="destructive" onClick={close} disabled={pending}>
            {nonTerminalStudents.length}{" "}
            {nonTerminalStudents.length === 1 ? "student" : "students"} still not home. Close out anyway?
          </Button>
          <Button variant="outline" onClick={() => setConfirmingClose(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button onClick={close} disabled={pending}>Mark closed</Button>
      )}
    </div>
  );
}
