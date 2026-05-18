import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vans — Coordinator" };

type VanRow = { id: string; name: string; capacity: number; active: boolean };
type LocationRow = {
  van_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  reported_at: string;
};
type AssignmentRow = {
  van_id: string;
  driver_user_id: string | null;
  aide_user_id: string | null;
};

export default async function CoordinatorVansPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: vans } = await supabase
    .from("vans")
    .select("id, name, capacity, active")
    .order("name")
    .returns<VanRow[]>();

  const { data: locations } = await supabase
    .from("van_locations")
    .select("van_id, lat, lng, accuracy_m, reported_at")
    .returns<LocationRow[]>();

  const { data: assignments } = await supabase
    .from("van_assignments")
    .select("van_id, driver_user_id, aide_user_id")
    .eq("assignment_date", today)
    .returns<AssignmentRow[]>();

  const locMap = new Map((locations ?? []).map((l) => [l.van_id, l]));
  const assignMap = new Map((assignments ?? []).map((a) => [a.van_id, a]));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Vans</h1>
        <p className="text-muted-foreground text-sm">
          Live positions broadcast from each van&apos;s aide phone.
        </p>
      </header>

      <ul className="space-y-3">
        {(vans ?? []).map((v) => {
          const loc = locMap.get(v.id);
          const assign = assignMap.get(v.id);
          return (
            <li
              key={v.id}
              className="rounded-lg border bg-card p-4 flex flex-wrap items-center gap-4 justify-between"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{v.name}</span>
                  <Badge variant={v.active ? "default" : "muted"}>
                    {v.active ? "active" : "inactive"}
                  </Badge>
                  {assign ? (
                    <Badge variant="secondary">assigned today</Badge>
                  ) : (
                    <Badge variant="muted">no assignment today</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Capacity {v.capacity}
                </div>
              </div>
              <div className="text-right space-y-1">
                {loc ? (
                  <>
                    <div className="text-sm font-mono">
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ±{Math.round(loc.accuracy_m ?? 0)}m · updated{" "}
                      {fmtAgo(loc.reported_at)}{" "}
                      <a
                        className="underline ml-1"
                        href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        view on map
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No location reported yet
                  </div>
                )}
                <Link
                  href={`/van/${v.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open manifest
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Aides start the broadcast by opening their van page and tapping{" "}
        <strong>Start broadcast</strong>. Positions refresh roughly every 5–10 seconds.
      </p>
    </main>
  );
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
