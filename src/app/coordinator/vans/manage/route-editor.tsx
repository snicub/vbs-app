"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { setVanRoutes } from "@/server-actions/vans";
import { orderStopIds } from "@/lib/vans";

type StopVM = { id: string; name: string; town: string; colorCode: string; colorName: string };
type RouteVM = { vanId: string; direction: "am" | "pm"; stopIds: string[] };

export function RouteEditor({
  vans,
  stops,
  routes,
}: {
  vans: { id: string; name: string }[];
  stops: StopVM[];
  routes: RouteVM[];
}) {
  if (vans.length === 0) {
    return <p className="text-sm text-muted-foreground">Add an active van first.</p>;
  }
  if (stops.length === 0) {
    return <p className="text-sm text-muted-foreground">No stops defined yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {vans.map((v) => {
        const am = routes.find((r) => r.vanId === v.id && r.direction === "am")?.stopIds ?? [];
        const pm = routes.find((r) => r.vanId === v.id && r.direction === "pm")?.stopIds ?? [];
        return <VanRoutes key={v.id} van={v} stops={stops} initialAm={am} initialPm={pm} />;
      })}
    </ul>
  );
}

function VanRoutes({
  van,
  stops,
  initialAm,
  initialPm,
}: {
  van: { id: string; name: string };
  stops: StopVM[];
  initialAm: string[];
  initialPm: string[];
}) {
  const router = useRouter();
  const [am, setAm] = useState<Set<string>>(() => new Set(initialAm));
  const [pm, setPm] = useState<Set<string>>(() => new Set(initialPm));
  const [pending, startTransition] = useTransition();

  const dirty = !sameSet(am, initialAm) || !sameSet(pm, initialPm);

  function toggle(
    current: Set<string>,
    setter: (s: Set<string>) => void,
    id: string,
    checked: boolean,
  ) {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    setter(next);
  }

  function save() {
    startTransition(async () => {
      const result = await setVanRoutes({
        vanId: van.id,
        amStopIds: orderStopIds(am, stops),
        pmStopIds: orderStopIds(pm, stops),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${van.name} routes saved`);
      router.refresh();
    });
  }

  return (
    <li className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{van.name}</span>
        <Button onClick={save} disabled={pending || !dirty} size="sm">
          {pending ? "Saving…" : "Save routes"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RouteColumn
          title="Morning pickup"
          stops={stops}
          selected={am}
          onToggle={(id, c) => toggle(am, setAm, id, c)}
        />
        <RouteColumn
          title="Afternoon drop-off"
          stops={stops}
          selected={pm}
          onToggle={(id, c) => toggle(pm, setPm, id, c)}
        />
      </div>
    </li>
  );
}

function RouteColumn({
  title,
  stops,
  selected,
  onToggle,
}: {
  title: string;
  stops: StopVM[];
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-1.5">
        {stops.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(s.id)} onCheckedChange={(c: boolean) => onToggle(s.id, c)} />
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-3 shrink-0 rounded-full border"
                  style={{ backgroundColor: s.colorCode }}
                  aria-hidden
                />
                {s.town} <span className="text-muted-foreground">({s.name})</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sameSet(set: Set<string>, arr: string[]): boolean {
  if (set.size !== arr.length) return false;
  for (const id of arr) if (!set.has(id)) return false;
  return true;
}
