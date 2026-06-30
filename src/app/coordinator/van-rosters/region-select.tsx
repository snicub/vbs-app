"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setStudentVan } from "@/server-actions/day-record";

/**
 * Per-rider van/region picker on the driver sheet (screen only — hidden on the
 * printout). Changing it moves the child onto that van for the viewed day and
 * the rest of VBS, so a wrong-region assignment is fixed in one tap right where
 * the coordinator notices it.
 */
export function RegionSelect({
  studentId,
  currentVanId,
  eventDate,
  vans,
}: {
  studentId: string;
  currentVanId: string | null;
  eventDate: string;
  vans: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(vanId: string) {
    if (!vanId || vanId === currentVanId) return;
    const vanName = vans.find((v) => v.id === vanId)?.name ?? "van";
    startTransition(async () => {
      const res = await setStudentVan({ studentId, vanId, eventDate });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved to ${vanName} for the rest of VBS`);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Move to van"
      disabled={pending}
      value={currentVanId ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="print:hidden h-9 max-w-[10rem] rounded-md border bg-card px-2 text-xs disabled:opacity-50"
    >
      <option value="" disabled>
        {pending ? "Moving…" : "Move to…"}
      </option>
      {vans.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}
