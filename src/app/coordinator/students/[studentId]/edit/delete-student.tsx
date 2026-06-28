"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveStudent } from "@/server-actions/students";
import { ArchiveIcon } from "lucide-react";

export function DeleteStudentSection({
  studentId,
  name,
}: {
  studentId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmArchive() {
    startTransition(async () => {
      const result = await archiveStudent({ studentId });
      if (!result.ok) {
        toast.error(result.error);
        setOpen(false);
        return;
      }
      toast.success(`${name} removed from rosters`);
      router.push("/coordinator/students");
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-sm uppercase tracking-wide text-destructive">
          Remove from roster
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hide {name} from every roster and check-in screen. Their records (check-in
          history, consents, plans) are kept, and you can restore them later from the
          Archived list on the Students page.
        </p>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <ArchiveIcon /> Remove from roster
      </Button>

      <ConfirmDialog
        open={open}
        title={`Remove ${name} from rosters?`}
        description={
          <>
            <strong>{name}</strong> will be hidden from rosters and check-in screens.
            Nothing is deleted — their records are kept and you can restore them anytime
            from the Archived list.
          </>
        }
        confirmLabel="Remove from roster"
        pending={pending}
        onConfirm={confirmArchive}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
