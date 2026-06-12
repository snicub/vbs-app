"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { createVan, updateVan } from "@/server-actions/vans";

type VanVM = { id: string; name: string; capacity: number; plate: string | null; active: boolean };

export function VanListEditor({ vans }: { vans: VanVM[] }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {vans.map((v) => (
          <VanRow key={v.id} van={v} />
        ))}
        {vans.length === 0 && (
          <li className="text-sm text-muted-foreground">No vans yet — add one below.</li>
        )}
      </ul>
      <AddVan />
    </div>
  );
}

function VanRow({ van }: { van: VanVM }) {
  const router = useRouter();
  const [name, setName] = useState(van.name);
  const [capacity, setCapacity] = useState(String(van.capacity));
  const [plate, setPlate] = useState(van.plate ?? "");
  const [active, setActive] = useState(van.active);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== van.name ||
    capacity !== String(van.capacity) ||
    plate !== (van.plate ?? "") ||
    active !== van.active;

  function save() {
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error("Capacity must be a whole number ≥ 1");
      return;
    }
    startTransition(async () => {
      const result = await updateVan({ vanId: van.id, name, capacity: cap, plate: plate || null, active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} saved`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-3 py-3">
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Capacity</span>
        <Input
          type="number"
          min={1}
          max={99}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="w-20"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Plate</span>
        <Input value={plate} onChange={(e) => setPlate(e.target.value)} className="w-28" placeholder="—" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox checked={active} onCheckedChange={(c: boolean) => setActive(c)} />
        <span>Active</span>
      </label>
      <Button onClick={save} disabled={pending || !dirty} size="sm" className="ml-auto">
        {pending ? "Saving…" : "Save"}
      </Button>
    </li>
  );
}

function AddVan() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("14");
  const [plate, setPlate] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    const cap = Number(capacity);
    if (name.trim().length === 0) {
      toast.error("Name is required");
      return;
    }
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error("Capacity must be a whole number ≥ 1");
      return;
    }
    startTransition(async () => {
      const result = await createVan({ name, capacity: cap, plate: plate || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name.trim()} added`);
      setName("");
      setCapacity("14");
      setPlate("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-3">
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">New van name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32" placeholder="Van 6" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Capacity</span>
        <Input
          type="number"
          min={1}
          max={99}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="w-20"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Plate</span>
        <Input value={plate} onChange={(e) => setPlate(e.target.value)} className="w-28" placeholder="optional" />
      </label>
      <Button onClick={add} disabled={pending} size="sm" className="ml-auto">
        {pending ? "Adding…" : "Add van"}
      </Button>
    </div>
  );
}
