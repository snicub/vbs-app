"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { contrastText } from "@/lib/nametags/tag-data";
import { UNASSIGNED_PIN_COLOR, type PinnableKid, type NoAddressKid } from "@/lib/van-assign-map";
import { assignStudentToVan } from "@/server-actions/students";
import { autoAssignStopsFromAddresses, locateStudentHomes } from "@/server-actions/routing";

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

      const markers = new Map<string, import("leaflet").Marker>();
      for (const k of pinnable) {
        const m = L.marker([k.lat, k.lng], {
          icon: pinIcon(L, k.name, k.currentVanColor, selectedRef.current.has(k.studentId)),
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
    for (const k of pinnable) {
      const m = ctx.markers.get(k.studentId);
      m?.setIcon(pinIcon(ctx.L, k.name, k.currentVanColor, selected.has(k.studentId)));
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
            selected={selected}
            onToggle={toggle}
            onLocate={flyTo}
          />
          {noAddress.length > 0 && <NoAddressList kids={noAddress} />}
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

function SideList({
  pinnable,
  selected,
  onToggle,
  onLocate,
}: {
  pinnable: PinnableKid[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onLocate: (k: PinnableKid) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-3 py-2 border-b text-sm font-semibold">
        Homes on the map ({pinnable.length})
      </div>
      {pinnable.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          No located homes for this day yet — use “Locate homes”.
        </p>
      ) : (
        <ul className="max-h-[42dvh] overflow-y-auto divide-y">
          {pinnable.map((k) => {
            const color = k.currentVanColor;
            const onVan = !!k.currentVanId;
            return (
              <li key={k.studentId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={selected.has(k.studentId)}
                  onChange={() => onToggle(k.studentId)}
                  aria-label={`Select ${k.name}`}
                />
                <span
                  className="inline-block size-3 rounded-full border shrink-0"
                  style={{ background: color }}
                  title={onVan ? "On a van" : "No van yet"}
                  aria-hidden
                />
                <button
                  type="button"
                  className="flex-1 text-left truncate hover:underline"
                  onClick={() => onLocate(k)}
                >
                  {k.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoAddressList({ kids }: { kids: NoAddressKid[] }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
      <div className="px-3 py-2 border-b border-amber-300 dark:border-amber-800 text-sm font-semibold text-amber-900 dark:text-amber-200">
        ⚠ Needs an address ({kids.length})
      </div>
      <p className="px-3 pt-2 text-xs text-amber-800 dark:text-amber-300">
        These kids ride a van but can&apos;t be pinned — add a home address so they aren&apos;t left off a van.
      </p>
      <ul className="px-1 py-2 divide-y divide-amber-200 dark:divide-amber-900">
        {kids.map((k) => (
          <li key={k.studentId} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="truncate">
              {k.name}
              {k.hasAddress && (
                <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(address not located)</span>
              )}
            </span>
            <Link
              href={`/coordinator/students/${k.studentId}/edit`}
              className="shrink-0 text-xs font-medium underline text-amber-900 dark:text-amber-200"
            >
              Edit
            </Link>
          </li>
        ))}
      </ul>
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

function pinIcon(
  L: typeof import("leaflet"),
  name: string,
  color: string,
  isSelected: boolean,
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
    iconAnchor: [0, 0],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}
