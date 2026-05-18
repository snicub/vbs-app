"use client";

import { useEffect, useRef, useState } from "react";
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
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    vanMarkers: Map<string, import("leaflet").Marker>;
    L: typeof import("leaflet");
  } | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>(initialLocations);

  // Initialize the map once.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mapRef.current || leafletRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapRef.current) return;

      // Fix the default-icon path issue with Webpack-bundled Leaflet.
      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current).setView(centerOfStops(stops), 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Plot stops as colored circles
      for (const s of stops) {
        L.circleMarker([s.lat, s.lng], {
          radius: 8,
          color: s.color_code,
          fillColor: s.color_code,
          fillOpacity: 0.7,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(`<b>${s.name}</b><br/>${s.town} · ${s.color_name}`);
      }

      leafletRef.current = { map, vanMarkers: new Map(), L };
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

  // Re-render van markers whenever locations change.
  useEffect(() => {
    renderVanMarkers(locations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  // Subscribe to realtime updates on van_locations.
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

    // Remove markers for vans that no longer have a row
    vanMarkers.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        vanMarkers.delete(id);
      }
    });
  }

  const hasGeocodedStops = stops.length > 0;
  const hasLocations = locations.length > 0;

  return (
    <>
      <div
        ref={mapRef}
        className="w-full rounded-lg border bg-card"
        style={{ height: "70vh", minHeight: 400 }}
      />
      {!hasGeocodedStops && (
        <p className="text-sm text-muted-foreground">
          No stops have lat/lng set — the map can&apos;t center automatically.
          Coordinators can edit stops in Studio to add coordinates.
        </p>
      )}
      {hasGeocodedStops && !hasLocations && (
        <p className="text-sm text-muted-foreground">
          No vans are broadcasting yet. Ask aides to open their van page and tap{" "}
          <strong>Start broadcast</strong>.
        </p>
      )}
    </>
  );
}

function centerOfStops(stops: StopRow[]): [number, number] {
  if (stops.length === 0) return [39.5, -98.35]; // continental US fallback
  let lat = 0;
  let lng = 0;
  for (const s of stops) {
    lat += s.lat;
    lng += s.lng;
  }
  return [lat / stops.length, lng / stops.length];
}

function vanIconHtml(name: string): string {
  return `<div style="background:#111;color:#fff;font:600 11px system-ui;padding:3px 8px;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${escapeHtml(name)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}
