"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getFamilyAccessUrl,
  rotateFamilyToken,
} from "@/server-actions/families";
import { CopyIcon, LinkIcon, RotateCwIcon } from "lucide-react";

/**
 * Coordinator-only panel for managing the family's parent-status link.
 * The link itself is in `family_access_tokens`; this is the only place
 * in the UI today where coordinators can view it or rotate it.
 *
 * Rotation = revoke all active tokens for the family + issue a fresh one.
 * Used when a screenshotted link leaks, a phone is stolen, etc.
 */
export function FamilyAccessPanel({ familyId }: { familyId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getFamilyAccessUrl({ familyId });
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setUrl(result.url);
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy — long-press the link instead"),
    );
  }

  function rotate() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const result = await rotateFamilyToken({ familyId });
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.url);
      toast.success("New link issued — old link no longer works");
    });
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <LinkIcon className="size-3.5" /> Parent status link
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : url ? (
        <>
          <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">
            {url}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              <CopyIcon /> Copy
            </Button>
            <Button
              type="button"
              size="sm"
              variant={confirming ? "destructive" : "outline"}
              onClick={rotate}
              disabled={pending}
            >
              <RotateCwIcon /> {confirming ? "Tap again to confirm" : "Rotate link"}
            </Button>
            {confirming && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Rotating revokes the current link immediately. Old screenshots
            will stop working. Text the new link to the family.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            No active parent link for this family.
          </div>
          <Button type="button" size="sm" onClick={rotate} disabled={pending}>
            <RotateCwIcon /> Issue parent link
          </Button>
        </div>
      )}
    </div>
  );
}
