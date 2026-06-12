import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";

const VanMap = dynamic(() => import("./van-map").then((m) => m.VanMap), {
  ssr: false,
  loading: () => (
    <div
      className="w-full rounded-lg border bg-muted animate-pulse flex items-center justify-center text-sm text-muted-foreground"
      style={{ height: "min(70dvh, 720px)", minHeight: 360 }}
    >
      Loading map…
    </div>
  ),
});

export const revalidate = 0;
export const metadata = { title: "Live Van Map — Coordinator" };

export default async function VanMapPage() {
  const supabase = await createClient();

  const { data: vans } = await supabase
    .from("vans")
    .select("id, name")
    .returns<{ id: string; name: string }[]>();

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, town, lat, lng, color_code, color_name")
    .returns<{
      id: string;
      name: string;
      town: string;
      lat: number | null;
      lng: number | null;
      color_code: string;
      color_name: string;
    }[]>();

  const { data: locations } = await supabase
    .from("van_locations")
    .select("van_id, lat, lng, accuracy_m, reported_at")
    .returns<{
      van_id: string;
      lat: number;
      lng: number;
      accuracy_m: number | null;
      reported_at: string;
    }[]>();

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Van Map</h1>
          <p className="text-muted-foreground text-sm">
            Positions update in real time as aides broadcast from their phones.
          </p>
        </div>
      </div>
      <VanMap
        vans={vans ?? []}
        stops={(stops ?? []).filter((s) => s.lat != null && s.lng != null) as {
          id: string;
          name: string;
          town: string;
          lat: number;
          lng: number;
          color_code: string;
          color_name: string;
        }[]}
        initialLocations={locations ?? []}
      />
    </main>
  );
}
