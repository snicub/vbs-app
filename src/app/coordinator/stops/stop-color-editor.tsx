"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateStopColor } from "@/server-actions/stops";

type StopVM = {
  id: string;
  name: string;
  town: string;
  colorCode: string;
  colorName: string;
};

export function StopColorEditor({ stops }: { stops: StopVM[] }) {
  return (
    <ul className="space-y-3">
      {stops.map((s) => (
        <StopRow key={s.id} stop={s} />
      ))}
    </ul>
  );
}

function StopRow({ stop }: { stop: StopVM }) {
  const router = useRouter();
  const [colorCode, setColorCode] = useState(stop.colorCode);
  const [colorName, setColorName] = useState(stop.colorName);
  const [pending, startTransition] = useTransition();

  const dirty = colorCode !== stop.colorCode || colorName !== stop.colorName;

  function save() {
    startTransition(async () => {
      const result = await updateStopColor({ stopId: stop.id, colorCode, colorName });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${stop.town} color saved`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-3">
      <span
        className="size-9 shrink-0 rounded-full border"
        style={{ backgroundColor: colorCode }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{stop.town}</div>
        <div className="truncate text-xs text-muted-foreground">{stop.name}</div>
      </div>
      <input
        type="color"
        value={colorCode}
        onChange={(e) => setColorCode(e.target.value)}
        className="h-9 w-12 shrink-0 cursor-pointer rounded border bg-background"
        aria-label={`${stop.town} color`}
      />
      <Input
        value={colorName}
        onChange={(e) => setColorName(e.target.value)}
        className="w-28"
        aria-label={`${stop.town} color name`}
      />
      <Button onClick={save} disabled={pending || !dirty} size="sm">
        {pending ? "Saving…" : "Save"}
      </Button>
    </li>
  );
}
