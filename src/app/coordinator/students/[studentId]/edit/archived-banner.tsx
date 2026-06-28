"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unarchiveStudent } from "@/server-actions/students";
import { ArchiveRestoreIcon } from "lucide-react";

export function ArchivedBanner({
  studentId,
  name,
}: {
  studentId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const result = await unarchiveStudent({ studentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} restored to rosters`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="font-medium text-sm">This child is archived</p>
        <p className="text-sm text-muted-foreground">
          Hidden from rosters and check-in screens. Their records were kept.
        </p>
      </div>
      <Button onClick={restore} disabled={pending} className="shrink-0">
        <ArchiveRestoreIcon /> {pending ? "Restoring…" : "Restore to roster"}
      </Button>
    </div>
  );
}
