"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createVan, updateVan, deleteVan, ensureVanZones } from "@/server-actions/vans";
import { Trash2Icon } from "lucide-react";

type VanVM = {
  id: string;
  name: string;
  capacity: number;
  plate: string | null;
  active: boolean;
  hasZone: boolean;
  colorCode: string | null;
  areaLocation: string | null;
  hasCoords: boolean;
  riderCount: number;
};

const DEFAULT_COLOR = "#0F766E";

export function VanListEditor({
  vans,
  missingZoneCount,
}: {
  vans: VanVM[];
  missingZoneCount: number;
}) {
  return (
    <div className="space-y-3">
      {missingZoneCount > 0 && <MissingZoneBanner count={missingZoneCount} />}
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

function MissingZoneBanner({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function provision() {
    startTransition(async () => {
      const result = await ensureVanZones();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.provisioned === 1
          ? "Set up 1 van — confirm its color & times below"
          : `Set up ${result.provisioned} vans — confirm their colors & times below`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--anomaly-warn)]/40 bg-[var(--anomaly-warn)]/10 px-3 py-3 text-sm">
      <span>
        {count === 1 ? "1 van can't carry kids yet" : `${count} vans can't carry kids yet`} — they have no
        pickup zone. Set one up, then confirm placeholder times.
      </span>
      <Button onClick={provision} disabled={pending} size="sm" variant="outline">
        {pending ? "Setting up…" : "Set up pickup zones"}
      </Button>
    </div>
  );
}

function VanRow({ van }: { van: VanVM }) {
  const router = useRouter();
  const [name, setName] = useState(van.name);
  const [capacity, setCapacity] = useState(String(van.capacity));
  const [plate, setPlate] = useState(van.plate ?? "");
  const [active, setActive] = useState(van.active);
  const [color, setColor] = useState(van.colorCode ?? DEFAULT_COLOR);
  const [area, setArea] = useState(van.areaLocation ?? "");
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  const dirty =
    name !== van.name ||
    capacity !== String(van.capacity) ||
    plate !== (van.plate ?? "") ||
    active !== van.active ||
    color !== (van.colorCode ?? DEFAULT_COLOR) ||
    area !== (van.areaLocation ?? "");

  function save() {
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error("Capacity must be a whole number ≥ 1");
      return;
    }
    startTransition(async () => {
      const result = await updateVan({
        vanId: van.id,
        name,
        capacity: cap,
        plate: plate || null,
        active,
        ...(van.hasZone
          ? {
              colorCode: color,
              // Only send (and re-geocode) the area when it actually changed, so an
              // unrelated save (color/name) can't fail on a transient geocode hiccup.
              ...(area !== (van.areaLocation ?? "") ? { areaAddress: area } : {}),
            }
          : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} saved`);
      router.refresh();
    });
  }

  function remove() {
    startDelete(async () => {
      // riderCount > 0 means kids are planned onto this van; the confirm dialog
      // already warned they'll be unassigned, so authorize it.
      const result = await deleteVan({
        vanId: van.id,
        unassignRiders: van.riderCount > 0,
      });
      if (!result.ok) {
        toast.error(result.error);
        setConfirmOpen(false);
        return;
      }
      toast.success(`${van.name} deleted`);
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 rounded-lg border bg-card px-3 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32" />
        </label>
        {van.hasZone && (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Color</span>
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-11 w-14 p-1"
            />
          </label>
        )}
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
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
            className="text-destructive hover:text-destructive"
          >
            <Trash2Icon /> Delete
          </Button>
          <Button onClick={save} disabled={pending || !dirty} size="sm">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {van.hasZone && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">
              Area location{" "}
              {van.hasCoords && area === (van.areaLocation ?? "") && (
                <span className="text-[var(--state-safe)]">· located ✓</span>
              )}
            </span>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="w-56"
              placeholder="e.g. North Sisseton, SD"
            />
          </label>
          <span className="text-xs text-muted-foreground">
            Optional — lets &ldquo;Suggest vans from addresses&rdquo; pick the nearest van for each home.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${van.name}?`}
        description={
          <>
            This removes <strong>{van.name}</strong>, its pickup zone/color, route, and
            driver/aide assignments. This cannot be undone.
            {van.riderCount > 0 && (
              <span className="mt-2 block text-[var(--anomaly-warn)]">
                {van.riderCount} student{van.riderCount === 1 ? "" : "s"} assigned to this van
                will be unassigned and need re-routing to another van.
              </span>
            )}
          </>
        }
        confirmLabel={van.riderCount > 0 ? "Unassign & delete" : "Delete van"}
        pending={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </li>
  );
}

function AddVan() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("14");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
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
      const result = await createVan({
        name,
        capacity: cap,
        plate: plate || undefined,
        colorCode: color,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name.trim()} added`);
      setName("");
      setCapacity("14");
      setPlate("");
      setColor(DEFAULT_COLOR);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed bg-muted/20 px-3 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">New van name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32" placeholder="Van 6" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Color</span>
          <Input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-11 w-14 p-1"
          />
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
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={add} disabled={pending} size="sm" className="ml-auto">
          {pending ? "Adding…" : "Add van"}
        </Button>
      </div>
    </div>
  );
}
