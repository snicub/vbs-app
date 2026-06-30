"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contrastText } from "@/lib/nametags/tag-data";
import { UNASSIGNED_PIN_COLOR, type PinnableKid, type NoAddressKid } from "@/lib/van-assign-map";
import { assignStudentToVan, assignStudentToVanAllDays } from "@/server-actions/students";
import {
  autoAssignStopsFromAddresses,
  locateStudentHomes,
  setStudentHomeAddress,
} from "@/server-actions/routing";

type VanOption = { id: string; name: string; colorCode: string | null };

export function PickupMap({
  date,
  pinnable,
  noAddress,
  locatableCount,
  vans,
}: {
  date: string;
  pinnable: PinnableKid[];
  noAddress: NoAddressKid[];
  locatableCount: number;
  vans: VanOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetVanId, setTargetVanId] = useState<string | null>(vans[0]?.id ?? null);
  const [pending, setPending] = useState<null | "assign" | "suggest" | "locate">(null);

  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    markers: Map<string, import("leaflet").Marker>;
    L: typeof import("leaflet");
  } | null>(null);
  // A ref mirror of `selected` so the marker click handler (bound once) reads
  // the live value without re-binding every render.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const toggle = useCallback((studentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(pinnable.map((k) => k.studentId)));
  }, [pinnable]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Initialize the map once.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!mapHostRef.current || leafletRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapHostRef.current) return;

      const map = L.map(mapHostRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        touchZoom: "center",
      }).setView(centerOf(pinnable), 12);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const stackIndex = buildStackIndex(pinnable);
      const markers = new Map<string, import("leaflet").Marker>();
      for (const k of pinnable) {
        const m = L.marker([k.lat, k.lng], {
          icon: pinIcon(
            L,
            k.name,
            k.currentVanColor,
            selectedRef.current.has(k.studentId),
            stackIndex.get(k.studentId) ?? 0,
          ),
          // A taller stack should sit above its neighbors so its chips aren't
          // clipped by a single-chip marker drawn later.
          riseOnHover: true,
        }).addTo(map);
        m.on("click", () => toggle(k.studentId));
        markers.set(k.studentId, m);
      }
      if (pinnable.length > 1) {
        map.fitBounds(
          L.latLngBounds(pinnable.map((k) => [k.lat, k.lng] as [number, number])),
          { padding: [48, 48] },
        );
      }

      leafletRef.current = { map, markers, L };
    }
    init();
    return () => {
      cancelled = true;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-style markers when selection changes (color is server-driven, refreshed
  // by router.refresh() after an assign, so it's fixed for a given render).
  useEffect(() => {
    const ctx = leafletRef.current;
    if (!ctx) return;
    const stackIndex = buildStackIndex(pinnable);
    for (const k of pinnable) {
      const m = ctx.markers.get(k.studentId);
      m?.setIcon(
        pinIcon(
          ctx.L,
          k.name,
          k.currentVanColor,
          selected.has(k.studentId),
          stackIndex.get(k.studentId) ?? 0,
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pinnable]);

  const flyTo = useCallback((k: PinnableKid) => {
    const ctx = leafletRef.current;
    if (!ctx) return;
    ctx.map.flyTo([k.lat, k.lng], 15, { duration: 0.6 });
  }, []);

  async function runAssign() {
    if (!targetVanId || selected.size === 0) return;
    const ids = Array.from(selected);
    setPending("assign");
    try {
      const results = await Promise.allSettled(
        ids.map((studentId) => assignStudentToVan({ studentId, eventDate: date, vanId: targetVanId })),
      );
      const failures: string[] = [];
      let okCount = 0;
      results.forEach((res, i) => {
        if (res.status === "rejected") {
          const name = pinnable.find((k) => k.studentId === ids[i])?.name ?? "A kid";
          failures.push(`${name}: request failed`);
          return;
        }
        if (res.value.ok) {
          okCount++;
          return;
        }
        const name = pinnable.find((k) => k.studentId === ids[i])?.name ?? "A kid";
        failures.push(`${name}: ${res.value.error}`);
      });
      const vanName = vans.find((v) => v.id === targetVanId)?.name ?? "the van";
      if (okCount > 0) toast.success(`Put ${okCount} kid${okCount === 1 ? "" : "s"} on ${vanName}`);
      for (const f of failures) toast.error(f);
      if (okCount > 0) {
        setSelected(new Set());
        router.refresh();
      }
    } finally {
      setPending(null);
    }
  }

  async function runSuggest() {
    setPending("suggest");
    try {
      const r = await autoAssignStopsFromAddresses({ eventDate: date });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const parts = [`${r.assigned} assigned to a van`];
      if (r.geocoded) parts.push(`${r.geocoded} homes located`);
      if (r.flagged) parts.push(`${r.flagged} still need an address`);
      if (r.pending) parts.push(`${r.pending} not located yet — run again`);
      toast.success(parts.join(" · "));
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function runLocate() {
    setPending("locate");
    try {
      const r = await locateStudentHomes({ eventDate: date });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${r.located} home${r.located === 1 ? "" : "s"} located` +
          (r.stillMissing ? ` · ${r.stillMissing} still missing` : ""),
      );
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const targetVan = vans.find((v) => v.id === targetVanId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending !== null} onClick={runSuggest}>
          {pending === "suggest" ? "Suggesting…" : "Suggest from addresses"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null || locatableCount === 0}
          onClick={runLocate}
        >
          {pending === "locate"
            ? "Locating…"
            : `Locate ${locatableCount} home${locatableCount === 1 ? "" : "s"}`}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div>
          <div
            ref={mapHostRef}
            className="w-full rounded-lg border bg-card"
            style={{ height: "min(72dvh, 760px)", minHeight: 420 }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Tap a pin (or use the list) to select. Use <span className="font-mono">+ / −</span> to zoom.
          </p>
        </div>

        <aside className="space-y-3">
          <SideList
            pinnable={pinnable}
            vans={vans}
            selected={selected}
            onToggle={toggle}
            onLocate={flyTo}
            onSelectAll={selectAll}
            onClear={clearSelection}
          />
          {noAddress.length > 0 && <NoAddressList kids={noAddress} vans={vans} />}
        </aside>
      </div>

      <div className="sticky bottom-0 z-[1000] rounded-lg border bg-card/95 backdrop-blur p-3 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium shrink-0">Put on:</span>
          {vans.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No active vans — set up vans first on the Vans screen.
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {vans.map((v) => {
                const active = v.id === targetVanId;
                const color = v.colorCode ?? UNASSIGNED_PIN_COLOR;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setTargetVanId(v.id)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 min-h-9 text-sm font-medium " +
                      (active ? "ring-2 ring-offset-1 ring-foreground" : "hover:bg-muted")
                    }
                  >
                    <span
                      className="inline-block size-3 rounded-full border"
                      style={{ background: color }}
                      aria-hidden
                    />
                    {v.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={pending !== null || selected.size === 0 || !targetVanId}
          onClick={runAssign}
        >
          {pending === "assign"
            ? "Assigning…"
            : `Put ${selected.size} kid${selected.size === 1 ? "" : "s"} on ${targetVan?.name ?? "van"}`}
        </Button>
      </div>
    </div>
  );
}

/** Group located kids by their current van/region — named vans alphabetical,
 *  "No van yet" last; kids sorted by name within each region. */
function groupByRegion(
  pinnable: PinnableKid[],
  vans: VanOption[],
): { key: string; name: string; color: string; kids: PinnableKid[] }[] {
  const vanById = new Map(vans.map((v) => [v.id, v]));
  const byVan = new Map<string, PinnableKid[]>();
  for (const k of pinnable) {
    const key = k.currentVanId ?? "__none__";
    (byVan.get(key) ?? byVan.set(key, []).get(key)!).push(k);
  }
  return Array.from(byVan.entries())
    .map(([key, kids]) => {
      const van = key === "__none__" ? undefined : vanById.get(key);
      return {
        key,
        name: van?.name ?? "No van yet",
        color: van?.colorCode ?? UNASSIGNED_PIN_COLOR,
        kids: kids.slice().sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.name.localeCompare(b.name);
    });
}

function SideList({
  pinnable,
  vans,
  selected,
  onToggle,
  onLocate,
  onSelectAll,
  onClear,
}: {
  pinnable: PinnableKid[];
  vans: VanOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onLocate: (k: PinnableKid) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const allSelected = pinnable.length > 0 && selected.size >= pinnable.length;
  const groups = groupByRegion(pinnable, vans);
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
        <span className="font-semibold">Homes on the map ({pinnable.length})</span>
        {pinnable.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={allSelected ? onClear : onSelectAll}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {allSelected ? "Clear" : "Select all"}
            </button>
            {selected.size > 0 && !allSelected && (
              <button
                type="button"
                onClick={onClear}
                className="text-muted-foreground underline-offset-2 hover:underline"
              >
                Clear ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>
      {pinnable.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          No located homes for this day yet — use “Locate homes”.
        </p>
      ) : (
        <div className="max-h-[42dvh] overflow-y-auto">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/80 px-3 py-1.5 text-xs font-semibold backdrop-blur">
                <span
                  className="inline-block size-3 rounded-full border shrink-0"
                  style={{ background: g.color }}
                  aria-hidden
                />
                {g.name} ({g.kids.length})
              </div>
              <ul className="divide-y">
                {g.kids.map((k) => (
                  <li key={k.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={selected.has(k.studentId)}
                      onChange={() => onToggle(k.studentId)}
                      aria-label={`Select ${k.name}`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => onLocate(k)}
                    >
                      {k.name}
                    </button>
                    <AddressEditor
                      studentId={k.studentId}
                      initialStreet={k.street}
                      initialCity={k.city}
                      cta="Edit address"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoAddressList({ kids, vans }: { kids: NoAddressKid[]; vans: VanOption[] }) {
  const failed = kids.filter((k) => k.hasAddress && k.geocodeFailed);
  const notLocated = kids.filter((k) => k.hasAddress && !k.geocodeFailed);
  const missing = kids.filter((k) => !k.hasAddress);
  return (
    <div className="space-y-2">
      {failed.length > 0 && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40">
          <div className="px-3 py-2 border-b border-rose-300 dark:border-rose-800 text-sm font-semibold text-rose-900 dark:text-rose-200">
            ⚠ Address didn&apos;t match ({failed.length})
          </div>
          <p className="px-3 pt-2 text-xs text-rose-800 dark:text-rose-300">
            These kids ride a van and have an address, but it couldn&apos;t be found on the map —
            check it for typos and fix it, then tap &ldquo;Locate&rdquo; again.
          </p>
          <ul className="px-1 py-2 divide-y divide-rose-200 dark:divide-rose-900">
            {failed.map((k) => (
              <li key={k.studentId} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{k.name}</span>
                <RegionAssign studentId={k.studentId} vans={vans} />
                <AddressEditor
                  studentId={k.studentId}
                  initialStreet={k.street}
                  initialCity={k.city}
                  cta="Fix address"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {notLocated.length > 0 && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40">
          <div className="px-3 py-2 border-b border-sky-300 dark:border-sky-800 text-sm font-semibold text-sky-900 dark:text-sky-200">
            📍 Not on the map yet ({notLocated.length})
          </div>
          <p className="px-3 pt-2 text-xs text-sky-800 dark:text-sky-300">
            These kids have a home address — tap{" "}
            <strong>“Locate {notLocated.length} home{notLocated.length === 1 ? "" : "s"}”</strong> above to place
            them on the map.
          </p>
          <ul className="px-1 py-2 divide-y divide-sky-200 dark:divide-sky-900">
            {notLocated.map((k) => (
              <li key={k.studentId} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{k.name}</span>
                <RegionAssign studentId={k.studentId} vans={vans} />
                <AddressEditor
                  studentId={k.studentId}
                  initialStreet={k.street}
                  initialCity={k.city}
                  cta="Edit address"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="px-3 py-2 border-b border-amber-300 dark:border-amber-800 text-sm font-semibold text-amber-900 dark:text-amber-200">
            ⚠ Needs an address ({missing.length})
          </div>
          <p className="px-3 pt-2 text-xs text-amber-800 dark:text-amber-300">
            These kids ride a van but have no home address on file — add one so they aren&apos;t left off a van.
          </p>
          <ul className="px-1 py-2 divide-y divide-amber-200 dark:divide-amber-900">
            {missing.map((k) => (
              <li key={k.studentId} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{k.name}</span>
                <RegionAssign studentId={k.studentId} vans={vans} />
                <AddressEditor
                  studentId={k.studentId}
                  initialStreet={k.street}
                  initialCity={k.city}
                  cta="Add address"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Compact "assign to a region" dropdown for a kid whose address can't be placed
 * on the map. Bypasses geocoding entirely — the coordinator knows the region, so
 * picking it here puts the kid on that van for EVERY VBS day. The address is still
 * the driver's job to navigate; this just sets the van/color.
 */
function RegionAssign({ studentId, vans }: { studentId: string; vans: VanOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function assign(vanId: string) {
    if (!vanId) return;
    startTransition(async () => {
      const r = await assignStudentToVanAllDays({ studentId, vanId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Assigned to ${vans.find((v) => v.id === vanId)?.name ?? "the van"} (all days)`);
      router.refresh();
    });
  }

  if (vans.length === 0) return null;
  return (
    <select
      defaultValue=""
      disabled={pending}
      onChange={(e) => assign(e.target.value)}
      className="shrink-0 rounded border bg-card px-1.5 py-1 text-xs"
      aria-label="Assign to a region"
    >
      <option value="">{pending ? "Assigning…" : "Assign to region…"}</option>
      {vans.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Inline home-address editor used wherever a kid appears in the side panel. Saves
 * the family's street + city and geocodes on the spot, so a wrong pin jumps to the
 * corrected location (or a missing home appears) without leaving the map.
 */
function AddressEditor({
  studentId,
  initialStreet,
  initialCity,
  cta,
}: {
  studentId: string;
  initialStreet: string | null;
  initialCity: string | null;
  cta: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [street, setStreet] = useState(initialStreet ?? "");
  const [city, setCity] = useState(initialCity ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!street.trim() || !city.trim()) {
      toast.error("Enter both a street address and a city/town.");
      return;
    }
    startTransition(async () => {
      const r = await setStudentHomeAddress({ studentId, streetAddress: street, city });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.located
          ? "Saved & placed on the map ✓"
          : "Saved — but it still didn't match. Check the spelling.",
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-xs font-medium underline"
      >
        {cta}
      </button>
    );
  }

  return (
    <div className="mt-1 w-full space-y-1.5">
      <Input
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        placeholder="Street address"
        className="h-9 text-sm"
      />
      <Input
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="City / town (e.g. Sisseton)"
        className="h-9 text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save & locate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function centerOf(kids: PinnableKid[]): [number, number] {
  if (kids.length === 0) return [39.5, -98.35];
  let lat = 0;
  let lng = 0;
  for (const k of kids) {
    lat += k.lat;
    lng += k.lng;
  }
  return [lat / kids.length, lng / kids.length];
}

// Kids who share a home (siblings) geocode to the SAME point, so their name
// chips would render exactly on top of each other. Give each kid at a coordinate
// a 0-based slot so the chips can fan upward and every name stays readable.
const STACK_ROW_PX = 26;

function buildStackIndex(kids: PinnableKid[]): Map<string, number> {
  const seenAtCoord = new Map<string, number>();
  const index = new Map<string, number>();
  for (const k of kids) {
    const key = `${k.lat.toFixed(5)},${k.lng.toFixed(5)}`;
    const slot = seenAtCoord.get(key) ?? 0;
    index.set(k.studentId, slot);
    seenAtCoord.set(key, slot + 1);
  }
  return index;
}

function pinIcon(
  L: typeof import("leaflet"),
  name: string,
  color: string,
  isSelected: boolean,
  stackIndex: number,
): import("leaflet").DivIcon {
  const text = contrastText(color);
  const ring = isSelected ? "box-shadow:0 0 0 3px #0f172a;" : "";
  const check = isSelected ? "☑" : "☐";
  return L.divIcon({
    className: "",
    html:
      `<div style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;` +
      `background:${color};color:${text};font:600 12px system-ui;padding:3px 8px;` +
      `border-radius:8px;border:2px solid #fff;${ring}">` +
      `<span style="font-size:13px;line-height:1">${check}</span>${escapeHtml(name)}</div>`,
    iconSize: [0, 0],
    // Offset each chip at a shared coordinate up by one row so stacked siblings
    // fan out into a readable list instead of hiding under one another.
    iconAnchor: [0, stackIndex * STACK_ROW_PX],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}
