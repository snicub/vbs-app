"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setVanAssignment } from "@/server-actions/vans";
import { sameDriverAndAide } from "@/lib/vans";

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
        Running a region with more than one van? List the crews comma-separated, in
        the same order — e.g. Driver <strong>John, Mike, Sam</strong> + Aide{" "}
        <strong>Jane, Sue, Amy</strong> = 3 crews. The driver sheets split that region&apos;s
        kids into one page per crew.
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
  const [driver, setDriver] = useState(driverName ?? "");
  const [aide, setAide] = useState(aideName ?? "");
  const [pending, startTransition] = useTransition();

  const dirty = driver !== (driverName ?? "") || aide !== (aideName ?? "");

  function save() {
    if (sameDriverAndAide(driver, aide)) {
      toast.error("Driver and aide must be different people");
      return;
    }
    startTransition(async () => {
      const result = await setVanAssignment({
        vanId: van.id,
        assignmentDate: date,
        driverName: driver,
        aideName: aide,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${van.name} assignment saved`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-3 py-3">
      <span className="w-full font-medium sm:w-20">{van.name}</span>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Driver(s)</span>
        <Input
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
          placeholder="e.g. John  (or John, Mike, Sam)"
          maxLength={200}
          autoComplete="off"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Aide(s)</span>
        <Input
          value={aide}
          onChange={(e) => setAide(e.target.value)}
          placeholder="e.g. Jane  (or Jane, Sue, Amy)"
          maxLength={200}
          autoComplete="off"
        />
      </label>
      <Button onClick={save} disabled={pending || !dirty} size="sm" className="ml-auto">
        {pending ? "Saving…" : "Save"}
      </Button>
    </li>
  );
}
