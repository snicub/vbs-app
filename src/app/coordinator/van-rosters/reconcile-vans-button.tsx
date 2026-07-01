"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reconcileVansFromAddressRules } from "@/server-actions/routing";

/**
 * Driver-sheet action (screen only): re-check every rider's van against the
 * address street-rules and fix any on the wrong van, for the viewed day onward.
 * Fills the gap "Suggest vans from addresses" leaves — that only routes kids with
 * no van yet, never corrects a wrong one.
 */
export function ReconcileVansButton({ date }: { date: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run() {
    setPending(true);
    try {
      const r = await reconcileVansFromAddressRules({ eventDate: date });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.moved === 0 && r.skippedBoarded === 0) {
        toast.success("Every rider already matches their address — nothing to fix.");
      } else {
        const parts = [`${r.moved} moved to the right van`];
        if (r.skippedBoarded) parts.push(`${r.skippedBoarded} skipped (on the van now)`);
        toast.success(parts.join(" · "));
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run} className="print:hidden">
      {pending ? "Checking…" : "Fix vans from addresses"}
    </Button>
  );
}
