import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
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
type StatusRow = {
  student_id: string;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  state: string;
};

export default async function CoordinatorVansPage() {
  const supabase = await createClient();
  const today = getLocalDate();

  const { data: vans } = await supabase
    .from("vans")
    .select("id, name, capacity, active")
    .eq("active", true)
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

  // Count today's assigned riders per van (AM and PM separately — a kid on
  // van 1 AM but van 2 PM counts toward 1's AM and 2's PM, not both).
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, morning_van_id, afternoon_van_id, state")
    .eq("event_date", today)
    .eq("attending", true)
    .returns<StatusRow[]>();

  // Capacity counts exclude no-shows from AM and home-already kids from PM —
  // a 14-seat van that "had" 16 assigned but 2 are already home is not over.
  const amCounts = new Map<string, number>();
  const pmCounts = new Map<string, number>();
  for (const s of statuses ?? []) {
    if (s.morning_van_id && s.state !== "marked_no_show") {
      amCounts.set(s.morning_van_id, (amCounts.get(s.morning_van_id) ?? 0) + 1);
    }
    if (s.afternoon_van_id && s.state !== "home" && s.state !== "marked_no_show") {
      pmCounts.set(s.afternoon_van_id, (pmCounts.get(s.afternoon_van_id) ?? 0) + 1);
    }
  }

  const locMap = new Map((locations ?? []).map((l) => [l.van_id, l]));
  const assignMap = new Map((assignments ?? []).map((a) => [a.van_id, a]));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vans</h1>
          <p className="text-muted-foreground text-sm">
            Live positions broadcast from each van&apos;s aide phone.
          </p>
        </div>
        <Link
          href="/coordinator/vans/manage"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Manage vans, routes &amp; drivers
        </Link>
      </header>

      <ul className="space-y-3">
        {(vans ?? []).map((v) => {
          const loc = locMap.get(v.id);
          const assign = assignMap.get(v.id);
          const amCount = amCounts.get(v.id) ?? 0;
          const pmCount = pmCounts.get(v.id) ?? 0;
          const amOver = amCount > v.capacity;
          const pmOver = pmCount > v.capacity;
          return (
            <li
              key={v.id}
              className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 sm:justify-between"
              style={amOver || pmOver ? {
                borderColor: "var(--destructive)",
                borderWidth: 2,
              } : undefined}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{v.name}</span>
                  <Badge variant={v.active ? "default" : "muted"}>
                    {v.active ? "active" : "inactive"}
                  </Badge>
                  {assign ? (
                    <Badge variant="secondary">assigned today</Badge>
                  ) : (
                    <Badge variant="muted">no assignment today</Badge>
                  )}
                  {(amOver || pmOver) && (
                    <Badge variant="destructive">over capacity</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span>Capacity {v.capacity}</span>
                  <span className={amOver ? "text-destructive font-semibold" : ""}>
                    AM riders: {amCount}{amOver && ` (over by ${amCount - v.capacity})`}
                  </span>
                  <span className={pmOver ? "text-destructive font-semibold" : ""}>
                    PM riders: {pmCount}{pmOver && ` (over by ${pmCount - v.capacity})`}
                  </span>
                </div>
              </div>
              <div className="sm:text-right space-y-1 min-w-0">
                {loc ? (
                  <>
                    <div className="text-xs sm:text-sm font-mono truncate">
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
