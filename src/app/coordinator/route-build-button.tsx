"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { autoAssignStopsFromAddresses } from "@/server-actions/routing";

export function RouteBuildButton({ date }: { date: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run() {
    setPending(true);
    try {
      const r = await autoAssignStopsFromAddresses({ eventDate: date });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const parts = [`${r.assigned} assigned to a van`];
      if (r.geocoded) parts.push(`${r.geocoded} addresses located`);
      if (r.flagged) parts.push(`${r.flagged} still need an address`);
      if (r.pending) parts.push(`${r.pending} not located yet — run again`);
      toast.success(parts.join(" · "));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
      {pending ? "Suggesting…" : "Suggest vans from addresses"}
    </Button>
  );
}
