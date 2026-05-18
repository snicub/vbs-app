"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { broadcastAnnouncement } from "@/server-actions/announcements";

export function AnnouncementForm() {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<null | { recipients: number }>(null);

  function send() {
    startTransition(async () => {
      const r = await broadcastAnnouncement({ body });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSent({ recipients: r.recipients });
      setBody("");
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Message (≤ 320 chars)</Label>
        <Textarea
          rows={5}
          maxLength={320}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="text-xs text-muted-foreground">
          {body.length}/320 chars
        </div>
      </div>
      {sent && (
        <div className="rounded border bg-muted/20 px-3 py-2 text-sm">
          Queued for {sent.recipients} families. Status will appear in
          notifications log.
        </div>
      )}
      <Button onClick={send} disabled={pending || body.trim().length === 0}>
        {pending ? "Sending…" : "Send to all families"}
      </Button>
    </div>
  );
}
