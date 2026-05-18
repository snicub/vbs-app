"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "leaflet/dist/leaflet.css";

type VanRow = { id: string; name: string };
type StopRow = {
  id: string;
  name: string;
  town: string;
  lat: number;
  lng: number;
  color_code: string;
  color_name: string;
};
type LocationRow = {
  van_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  reported_at: string;
};

export function VanMap({
  vans,
  stops,
  initialLocations,
}: {
  vans: VanRow[];
  stops: StopRow[];
  initialLocations: LocationRow[];
}) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    vanMarkers: Map<string, import("leaflet").Marker>;
    stopMarkers: import("leaflet").CircleMarker[];
    L: typeof import("leaflet");
  } | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>(initialLocations);
  const [now, setNow] = useState(Date.now());

  // Re-tick every 15s so "last seen" labels stay fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Initialize the map once.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!mapHostRef.current || leafletRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapHostRef.current) return;

      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapHostRef.current, { zoomControl: false }).setView(
        centerOfStops(stops),
        11,
      );
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const stopMarkers: import("leaflet").CircleMarker[] = [];
      for (const s of stops) {
        const m = L.circleMarker([s.lat, s.lng], {
          radius: 8,
          color: s.color_code,
          fillColor: s.color_code,
          fillOpacity: 0.7,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(`<b>${s.name}</b><br/>${s.town} · ${s.color_name}`);
        stopMarkers.push(m);
      }

      leafletRef.current = { map, vanMarkers: new Map(), stopMarkers, L };
      renderVanMarkers(locations);
    }
    init();
    return () => {
      cancelled = true;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render van markers when locations change.
  useEffect(() => {
    renderVanMarkers(locations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  // Realtime updates.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("van-locations-map")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "van_locations" },
        (payload) => {
          const row = payload.new as LocationRow | undefined;
          if (!row) return;
          setLocations((prev) => {
            const others = prev.filter((p) => p.van_id !== row.van_id);
            return [...others, row];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function renderVanMarkers(rows: LocationRow[]) {
    const ctx = leafletRef.current;
    if (!ctx) return;
    const { map, vanMarkers, L } = ctx;
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.van_id);
      const vanName = vans.find((v) => v.id === r.van_id)?.name ?? "Van";
      const existing = vanMarkers.get(r.van_id);
      const label = `<b>${vanName}</b><br/>±${Math.round(r.accuracy_m ?? 0)}m<br/>${new Date(r.reported_at).toLocaleTimeString()}`;
      if (existing) {
        existing.setLatLng([r.lat, r.lng]);
        existing.getPopup()?.setContent(label);
      } else {
        const icon = L.divIcon({
          className: "",
          html: vanIconHtml(vanName),
          iconSize: [44, 22],
          iconAnchor: [22, 11],
        });
        const m = L.marker([r.lat, r.lng], { icon }).addTo(map).bindPopup(label);
        vanMarkers.set(r.van_id, m);
      }
    }
    vanMarkers.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        vanMarkers.delete(id);
      }
    });
  }

  const flyToVan = useCallback((vanId: string) => {
    const ctx = leafletRef.current;
    const loc = locations.find((l) => l.van_id === vanId);
    if (!ctx || !loc) return;
    ctx.map.flyTo([loc.lat, loc.lng], 15, { duration: 0.8 });
    ctx.vanMarkers.get(vanId)?.openPopup();
  }, [locations]);

  const fitAll = useCallback(() => {
    const ctx = leafletRef.current;
    if (!ctx) return;
    const { L, map } = ctx;
    const points: [number, number][] = [
      ...locations.map((l) => [l.lat, l.lng] as [number, number]),
      ...stops.map((s) => [s.lat, s.lng] as [number, number]),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo(points[0]!, 13, { duration: 0.8 });
      return;
    }
    map.flyToBounds(L.latLngBounds(points), { padding: [40, 40], duration: 0.8 });
  }, [locations, stops]);

  const fitStops = useCallback(() => {
    const ctx = leafletRef.current;
    if (!ctx || stops.length === 0) return;
    const { L, map } = ctx;
    map.flyToBounds(
      L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])),
      { padding: [40, 40], duration: 0.8 },
    );
  }, [stops]);

  return (
    <div className="relative">
      <div
        ref={mapHostRef}
        className="w-full rounded-lg border bg-card"
        style={{ height: "calc(100dvh - 8rem)", minHeight: 400 }}
      />
      <MapControls
        vans={vans}
        locations={locations}
        now={now}
        onFitAll={fitAll}
        onFitStops={fitStops}
        onLocate={flyToVan}
        hasStops={stops.length > 0}
      />
    </div>
  );
}

function MapControls({
  vans,
  locations,
  now,
  onFitAll,
  onFitStops,
  onLocate,
  hasStops,
}: {
  vans: VanRow[];
  locations: LocationRow[];
  now: number;
  onFitAll: () => void;
  onFitStops: () => void;
  onLocate: (vanId: string) => void;
  hasStops: boolean;
}) {
  const [open, setOpen] = useState(true);
  const locMap = new Map(locations.map((l) => [l.van_id, l]));

  return (
    <div
      className={
        "absolute top-3 right-3 z-[1000] w-[min(280px,calc(100%-1.5rem))] " +
        "rounded-lg border bg-card/95 backdrop-blur shadow-lg"
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">Vans</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <div className="px-3 py-2 flex gap-2 border-b">
            <button
              type="button"
              onClick={onFitAll}
              disabled={locations.length === 0 && !hasStops}
              className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Fit all
            </button>
            <button
              type="button"
              onClick={onFitStops}
              disabled={!hasStops}
              className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Stops
            </button>
          </div>

          <ul className="max-h-[50dvh] overflow-y-auto divide-y">
            {vans.map((v) => {
              const loc = locMap.get(v.id);
              return (
                <li key={v.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {loc ? <span className="text-green-700 dark:text-green-400">● {fmtAgo(loc.reported_at, now)}</span> : "no GPS"}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={!loc}
                        onClick={() => onLocate(v.id)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                        aria-label={`Locate ${v.name}`}
                      >
                        Locate
                      </button>
                      <Link
                        href={`/van/${v.id}`}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Open
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function centerOfStops(stops: StopRow[]): [number, number] {
  if (stops.length === 0) return [39.5, -98.35];
  let lat = 0;
  let lng = 0;
  for (const s of stops) {
    lat += s.lat;
    lng += s.lng;
  }
  return [lat / stops.length, lng / stops.length];
}

function fmtAgo(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function vanIconHtml(name: string): string {
  return `<div style="background:#111;color:#fff;font:600 11px system-ui;padding:3px 8px;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${escapeHtml(name)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}
