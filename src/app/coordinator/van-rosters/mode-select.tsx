"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateStudentModeAllDays } from "@/server-actions/students";

/**
 * Per-rider travel-mode picker on the driver sheet (screen only). Changing it
 * sets how the child travels for every VBS day, so a kid the signup marked
 * parent-only can be switched to ride a van right here — then "Move to…" points
 * them at the right van. Clears the legs the new mode doesn't use.
 */
const MODE_OPTIONS = [
  { value: "van", label: "Van both ways" },
  { value: "parent_dropoff_only", label: "Parent drops AM · van home PM" },
  { value: "parent_pickup_only", label: "Van AM · parent picks up PM" },
  { value: "parent_both", label: "Parent both ways (no van)" },
] as const;

export function ModeSelect({ studentId, mode }: { studentId: string; mode: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    if (!next || next === mode) return;
    startTransition(async () => {
      const res = await updateStudentModeAllDays({ studentId, mode: next });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Travel mode updated for all VBS days");
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Travel mode"
      disabled={pending}
      value={mode ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="print:hidden h-9 max-w-[13rem] rounded-md border bg-card px-2 text-xs disabled:opacity-50"
    >
      <option value="" disabled>
        {pending ? "Saving…" : "Travel mode…"}
      </option>
      {MODE_OPTIONS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
