"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { closeoutDay, reopenDay } from "@/server-actions/closeout";

export function CloseoutForm({
  eventDate,
  pendingCount,
  existing,
}: {
  eventDate: string;
  pendingCount: number;
  existing: { closed_at: string; notes: string | null } | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, startTransition] = useTransition();

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
      <div className="rounded border bg-muted/20 p-3 text-sm">
        {pendingCount === 0
          ? "No anomalies open right now."
          : `${pendingCount} anomalies still open. Their state will be snapshotted into the closeout record.`}
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
      ) : (
        <Button onClick={close} disabled={pending}>Mark closed</Button>
      )}
    </div>
  );
}
