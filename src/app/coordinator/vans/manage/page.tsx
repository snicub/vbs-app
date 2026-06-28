import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { buttonVariants } from "@/components/ui/button";
import { zoneStopIdForVan } from "@/lib/vans";
import { VanListEditor } from "./van-list-editor";
import { AssignmentEditor } from "./assignment-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage Vans — Coordinator" };

type VanRow = { id: string; name: string; capacity: number; plate: string | null; active: boolean };
type StopRow = {
  id: string;
  name: string;
  town: string;
  color_code: string;
  color_name: string;
  street_address: string | null;
  lat: number | null;
  lng: number | null;
};
type RouteRow = { van_id: string; direction: "am" | "pm"; stop_ids: string[] };
type AssignmentRow = { van_id: string; driver_name: string | null; aide_name: string | null };

export default async function ManageVansPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const { date } = await searchParams;
  const day = date ?? getLocalDate();
  const supabase = await createClient();

  const [{ data: vans }, { data: stops }, { data: routes }, { data: assignments }] = await Promise.all([
    supabase.from("vans").select("id, name, capacity, plate, active").order("name").returns<VanRow[]>(),
    supabase
      .from("stops")
      .select("id, name, town, color_code, color_name, street_address, lat, lng")
      .order("sort_order")
      .returns<StopRow[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<RouteRow[]>(),
    supabase
      .from("van_assignments")
      .select("van_id, driver_name, aide_name")
      .eq("assignment_date", day)
      .returns<AssignmentRow[]>(),
  ]);

  const routeList = (routes ?? []).map((r) => ({
    van_id: r.van_id,
    direction: r.direction,
    stop_ids: r.stop_ids,
  }));
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  // Each van's pickup-zone stop, and how many distinct kids are planned onto it
  // (their day-record legs point at that zone, on any day). Drives the delete
  // confirmation — deleting a van unassigns these riders.
  const zoneByVan = new Map((vans ?? []).map((v) => [v.id, zoneStopIdForVan(v.id, routeList)]));
  const zoneStopIds = Array.from(
    new Set(Array.from(zoneByVan.values()).filter((id): id is string => !!id)),
  );
  const riderCountByZone = new Map<string, number>();
  if (zoneStopIds.length > 0) {
    const orFilter = zoneStopIds
      .flatMap((id) => [`morning_stop_id.eq.${id}`, `afternoon_stop_id.eq.${id}`])
      .join(",");
    const { data: planned } = await supabase
      .from("student_day_records")
      .select("student_id, morning_stop_id, afternoon_stop_id")
      .or(orFilter)
      .returns<{ student_id: string; morning_stop_id: string | null; afternoon_stop_id: string | null }[]>();
    const studentsByZone = new Map<string, Set<string>>();
    for (const rec of planned ?? []) {
      for (const sid of [rec.morning_stop_id, rec.afternoon_stop_id]) {
        if (sid && zoneStopIds.includes(sid)) {
          (studentsByZone.get(sid) ?? studentsByZone.set(sid, new Set()).get(sid)!).add(rec.student_id);
        }
      }
    }
    for (const [zone, set] of Array.from(studentsByZone)) riderCountByZone.set(zone, set.size);
  }

  const vanList = (vans ?? []).map((v) => {
    const zoneStopId = zoneByVan.get(v.id) ?? null;
    const zone = zoneStopId ? stopById.get(zoneStopId) : undefined;
    return {
      id: v.id,
      name: v.name,
      capacity: v.capacity,
      plate: v.plate,
      active: v.active,
      hasZone: !!zone,
      colorCode: zone?.color_code ?? null,
      areaLocation: zone?.street_address ?? null,
      hasCoords: zone?.lat != null && zone?.lng != null,
      riderCount: zoneStopId ? riderCountByZone.get(zoneStopId) ?? 0 : 0,
    };
  });
  const activeVans = vanList.filter((v) => v.active).map((v) => ({ id: v.id, name: v.name }));
  const vansMissingZone = vanList.filter((v) => !v.hasZone).length;
  const assignmentList = (assignments ?? []).map((a) => ({
    vanId: a.van_id,
    driverName: a.driver_name,
    aideName: a.aide_name,
  }));

  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-4 py-4 sm:py-6 space-y-8">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Manage vans</h1>
          <Link href="/coordinator/vans" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Van dashboard
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Each van is a pickup zone with its own color. A child rides the van their home is assigned to.
          Set the color here, then assign the day&apos;s driver &amp; aide.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Vans</h2>
        <VanListEditor vans={vanList} missingZoneCount={vansMissingZone} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Driver &amp; aide</h2>
        <AssignmentEditor date={day} vans={activeVans} assignments={assignmentList} />
      </section>
    </div>
  );
}
