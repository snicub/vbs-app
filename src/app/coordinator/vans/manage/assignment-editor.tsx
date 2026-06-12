"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { setVanAssignment } from "@/server-actions/vans";
import { sameDriverAndAide } from "@/lib/vans";

type StaffVM = { id: string; fullName: string; role: string };
type AssignVM = { vanId: string; driverUserId: string | null; aideUserId: string | null };

export function AssignmentEditor({
  date,
  vans,
  assignments,
  staff,
}: {
  date: string;
  vans: { id: string; name: string }[];
  assignments: AssignVM[];
  staff: StaffVM[];
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
                staff={staff}
                driverUserId={a?.driverUserId ?? null}
                aideUserId={a?.aideUserId ?? null}
              />
            );
          })}
        </ul>
      )}

      {staff.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No driver/aide accounts yet — volunteers appear here after they sign in once.
        </p>
      )}
    </div>
  );
}

function AssignRow({
  van,
  date,
  staff,
  driverUserId,
  aideUserId,
}: {
  van: { id: string; name: string };
  date: string;
  staff: StaffVM[];
  driverUserId: string | null;
  aideUserId: string | null;
}) {
  const router = useRouter();
  const [driver, setDriver] = useState(driverUserId ?? "");
  const [aide, setAide] = useState(aideUserId ?? "");
  const [pending, startTransition] = useTransition();

  const dirty = driver !== (driverUserId ?? "") || aide !== (aideUserId ?? "");

  function save() {
    if (sameDriverAndAide(driver || null, aide || null)) {
      toast.error("Driver and aide must be different people");
      return;
    }
    startTransition(async () => {
      const result = await setVanAssignment({
        vanId: van.id,
        assignmentDate: date,
        driverUserId: driver || null,
        aideUserId: aide || null,
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
        <span className="block text-muted-foreground">Driver</span>
        <Select value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="">— none —</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({u.role})
            </option>
          ))}
        </Select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Aide</span>
        <Select value={aide} onChange={(e) => setAide(e.target.value)}>
          <option value="">— none —</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({u.role})
            </option>
          ))}
        </Select>
      </label>
      <Button onClick={save} disabled={pending || !dirty} size="sm" className="ml-auto">
        {pending ? "Saving…" : "Save"}
      </Button>
    </li>
  );
}
