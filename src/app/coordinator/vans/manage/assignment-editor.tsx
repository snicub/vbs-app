"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setVanAssignment } from "@/server-actions/vans";
import { parseCrews } from "@/lib/van-rosters/pickup-order";
import { PlusIcon, XIcon } from "lucide-react";

type AssignVM = { vanId: string; driverName: string | null; aideName: string | null };
type Pair = { driver: string; aide: string };

function initialPairs(driverName: string | null, aideName: string | null): Pair[] {
  const crews = parseCrews(driverName, aideName);
  return crews.length > 0 ? crews : [{ driver: "", aide: "" }];
}

/** True when any pair lists the same person as both driver and aide. */
function hasSelfPair(pairs: Pair[]): boolean {
  return pairs.some((p) => {
    const d = p.driver.trim().toLowerCase();
    const a = p.aide.trim().toLowerCase();
    return !!d && d === a;
  });
}

/** Comma-joined (positional) so the driver sheets read them back as crews. */
function joinPairs(pairs: Pair[]): { driverName: string; aideName: string } {
  return {
    driverName: pairs.map((p) => p.driver.trim()).filter(Boolean).join(", "),
    aideName: pairs.map((p) => p.aide.trim()).filter(Boolean).join(", "),
  };
}

export function AssignmentEditor({
  date,
  vans,
  assignments,
}: {
  date: string;
  vans: { id: string; name: string }[];
  assignments: AssignVM[];
}) {
  const router = useRouter();
  // State is lifted here so a single "Save all" can write every van at once.
  // The whole editor is keyed by date at the call site, so it remounts (and
  // re-seeds from that day's assignments) when the date changes.
  const [pairsByVan, setPairsByVan] = useState<Record<string, Pair[]>>(() => {
    const m: Record<string, Pair[]> = {};
    for (const v of vans) {
      const a = assignments.find((x) => x.vanId === v.id);
      m[v.id] = initialPairs(a?.driverName ?? null, a?.aideName ?? null);
    }
    return m;
  });
  const [pending, startTransition] = useTransition();

  function update(vanId: string, fn: (ps: Pair[]) => Pair[]) {
    setPairsByVan((m) => ({ ...m, [vanId]: fn(m[vanId] ?? [{ driver: "", aide: "" }]) }));
  }

  function saveVan(vanId: string, vanName: string) {
    const pairs = pairsByVan[vanId] ?? [];
    if (hasSelfPair(pairs)) {
      toast.error("Driver and aide in a pair must be different people");
      return;
    }
    startTransition(async () => {
      const result = await setVanAssignment({ vanId, assignmentDate: date, ...joinPairs(pairs) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const n = pairs.filter((p) => p.driver.trim() || p.aide.trim()).length;
      toast.success(`${vanName} — ${n || "no"} ${n === 1 ? "pair" : "pairs"} saved`);
      router.refresh();
    });
  }

  function saveAll() {
    const offender = vans.find((v) => hasSelfPair(pairsByVan[v.id] ?? []));
    if (offender) {
      toast.error(`${offender.name}: driver and aide in a pair must be different people`);
      return;
    }
    startTransition(async () => {
      const results = await Promise.all(
        vans.map((v) =>
          setVanAssignment({ vanId: v.id, assignmentDate: date, ...joinPairs(pairsByVan[v.id] ?? []) }),
        ),
      );
      const errors = results.flatMap((r) => (r.ok ? [] : [r.error]));
      if (errors.length > 0) {
        toast.error(`Saved ${results.length - errors.length}/${results.length} vans — ${errors[0]}`);
      } else {
        toast.success(`All ${vans.length} vans saved`);
      }
      router.refresh();
    });
  }

  function changeDate(d: string) {
    const params = new URLSearchParams();
    if (d) params.set("date", d);
    router.push(`/coordinator/vans/manage?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="inline-block space-y-1 text-sm">
          <span className="block text-muted-foreground">Date</span>
          <Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="w-auto" />
        </label>
        {vans.length > 0 && (
          <Button onClick={saveAll} disabled={pending}>
            {pending ? "Saving…" : "Save all"}
          </Button>
        )}
      </div>

      <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Add a driver + aide <strong>pair for each van</strong> running the region
        (Long Hollows might have 2–3, Old Agency 2). The driver sheets split that
        region&apos;s kids into <strong>one page per pair</strong>, in pickup order.
      </p>

      {vans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add an active van first.</p>
      ) : (
        <ul className="space-y-2">
          {vans.map((v) => (
            <AssignRow
              key={v.id}
              van={v}
              pairs={pairsByVan[v.id] ?? [{ driver: "", aide: "" }]}
              pending={pending}
              onSetPair={(i, field, value) =>
                update(v.id, (ps) => ps.map((p, j) => (j === i ? { ...p, [field]: value } : p)))
              }
              onAddPair={() => update(v.id, (ps) => [...ps, { driver: "", aide: "" }])}
              onRemovePair={(i) => update(v.id, (ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ps))}
              onSave={() => saveVan(v.id, v.name)}
            />
          ))}
        </ul>
      )}

      {vans.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button onClick={saveAll} disabled={pending}>
            {pending ? "Saving…" : "Save all"}
          </Button>
        </div>
      )}
    </div>
  );
}

function AssignRow({
  van,
  pairs,
  pending,
  onSetPair,
  onAddPair,
  onRemovePair,
  onSave,
}: {
  van: { id: string; name: string };
  pairs: Pair[];
  pending: boolean;
  onSetPair: (i: number, field: keyof Pair, value: string) => void;
  onAddPair: () => void;
  onRemovePair: (i: number) => void;
  onSave: () => void;
}) {
  return (
    <li className="rounded-lg border bg-card px-3 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{van.name}</span>
        <Button onClick={onSave} disabled={pending} size="sm" variant="outline">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      {pairs.map((p, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
            Pair {i + 1}
          </span>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Driver</span>
            <Input
              value={p.driver}
              onChange={(e) => onSetPair(i, "driver", e.target.value)}
              placeholder="Driver name"
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Aide</span>
            <Input
              value={p.aide}
              onChange={(e) => onSetPair(i, "aide", e.target.value)}
              placeholder="Aide name"
              maxLength={60}
              autoComplete="off"
            />
          </label>
          {pairs.length > 1 && (
            <button
              type="button"
              onClick={() => onRemovePair(i)}
              className="mb-1 inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
              title={`Remove pair ${i + 1}`}
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={onAddPair}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <PlusIcon className="size-4" /> Add another driver/aide pair
      </button>
    </li>
  );
}
