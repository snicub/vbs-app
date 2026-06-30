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

  function changeDate(d: string) {
    const params = new URLSearchParams();
    if (d) params.set("date", d);
    router.push(`/coordinator/vans/manage?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <label className="inline-block space-y-1 text-sm">
        <span className="block text-muted-foreground">Date</span>
        <Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="w-auto" />
      </label>

      <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Add a driver + aide <strong>pair for each van</strong> running the region
        (Long Hollows might have 2–3, Old Agency 2). The driver sheets split that
        region&apos;s kids into <strong>one page per pair</strong>, in pickup order.
      </p>

      {vans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add an active van first.</p>
      ) : (
        <ul className="space-y-2">
          {vans.map((v) => {
            const a = assignments.find((x) => x.vanId === v.id);
            return (
              <AssignRow
                key={`${date}:${v.id}`}
                van={v}
                date={date}
                driverName={a?.driverName ?? null}
                aideName={a?.aideName ?? null}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Pair = { driver: string; aide: string };

function AssignRow({
  van,
  date,
  driverName,
  aideName,
}: {
  van: { id: string; name: string };
  date: string;
  driverName: string | null;
  aideName: string | null;
}) {
  const router = useRouter();
  const initial = parseCrews(driverName, aideName);
  const [pairs, setPairs] = useState<Pair[]>(
    initial.length > 0 ? initial : [{ driver: "", aide: "" }],
  );
  const [pending, startTransition] = useTransition();

  function setPair(i: number, field: keyof Pair, value: string) {
    setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
  }
  function addPair() {
    setPairs((ps) => [...ps, { driver: "", aide: "" }]);
  }
  function removePair(i: number) {
    setPairs((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ps));
  }

  function save() {
    for (const p of pairs) {
      const d = p.driver.trim().toLowerCase();
      const a = p.aide.trim().toLowerCase();
      if (d && a && d === a) {
        toast.error("Driver and aide in a pair must be different people");
        return;
      }
    }
    // Stored comma-joined (positional) so the driver sheets read them back as crews.
    const driverJoined = pairs.map((p) => p.driver.trim()).filter(Boolean).join(", ");
    const aideJoined = pairs.map((p) => p.aide.trim()).filter(Boolean).join(", ");
    startTransition(async () => {
      const result = await setVanAssignment({
        vanId: van.id,
        assignmentDate: date,
        driverName: driverJoined,
        aideName: aideJoined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const n = pairs.filter((p) => p.driver.trim() || p.aide.trim()).length;
      toast.success(`${van.name} — ${n || "no"} ${n === 1 ? "pair" : "pairs"} saved`);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border bg-card px-3 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{van.name}</span>
        <Button onClick={save} disabled={pending} size="sm">
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
              onChange={(e) => setPair(i, "driver", e.target.value)}
              placeholder="Driver name"
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Aide</span>
            <Input
              value={p.aide}
              onChange={(e) => setPair(i, "aide", e.target.value)}
              placeholder="Aide name"
              maxLength={60}
              autoComplete="off"
            />
          </label>
          {pairs.length > 1 && (
            <button
              type="button"
              onClick={() => removePair(i)}
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
        onClick={addPair}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <PlusIcon className="size-4" /> Add another driver/aide pair
      </button>
    </li>
  );
}
