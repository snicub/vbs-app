"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { updateTodayStops } from "@/server-actions/day-record";

type StopOption = {
  id: string;
  name: string;
  town: string;
  colorName: string;
};

export function ChangeStopsPanel({
  studentId,
  eventDate,
  currentMorningStopId,
  currentAfternoonStopId,
  stops,
}: {
  studentId: string;
  eventDate: string;
  currentMorningStopId: string | null;
  currentAfternoonStopId: string | null;
  stops: StopOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [am, setAm] = useState(currentMorningStopId ?? "");
  const [pm, setPm] = useState(currentAfternoonStopId ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateTodayStops({
        studentId,
        eventDate,
        morningStopId: am || null,
        afternoonStopId: pm || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Today's stops updated");
      setOpen(false);
      router.refresh();
    });
  }

  const summary =
    stops.find((s) => s.id === currentMorningStopId)?.name ?? "—";
  const summaryPm =
    stops.find((s) => s.id === currentAfternoonStopId)?.name ?? "—";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/40"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <div className="text-xs uppercase text-muted-foreground tracking-wide">
              Today&apos;s stops
            </div>
            <div className="font-medium">AM: {summary} · PM: {summaryPm}</div>
          </div>
          <span className="text-xs text-primary">Change…</span>
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="text-xs uppercase text-muted-foreground tracking-wide">
        Change today&apos;s stops
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Morning pickup</Label>
          <Select value={am} onChange={(e) => setAm(e.target.value)}>
            <option value="">— none —</option>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.town}, {s.colorName})
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Afternoon drop-off</Label>
          <Select value={pm} onChange={(e) => setPm(e.target.value)}>
            <option value="">— none —</option>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.town}, {s.colorName})
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
