import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { buttonVariants } from "@/components/ui/button";
import { zoneStopIdForVan } from "@/lib/vans";
import { ridesMorningVan, ridesAfternoonVan } from "@/lib/routing";
import { displayName } from "@/lib/nametags/tag-data";
import { buildVanAssignMapData, type KidRow, type VanZone } from "@/lib/van-assign-map";
import { PickupMap } from "./pickup-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pickup Map — Coordinator" };

type StatusRow = {
  student_id: string;
  attending: boolean;
  mode: string | null;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
};
type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  family_id: string;
};
type FamilyRow = {
  id: string;
  lat: number | null;
  lng: number | null;
  street_address: string | null;
  city: string | null;
  geocode_failed_at: string | null;
};
type VanRow = { id: string; name: string; active: boolean };
type StopRow = { id: string; color_code: string };
type RouteRow = { van_id: string; direction: "am" | "pm"; stop_ids: string[] };

export default async function PickupMapPage({
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
  const day = date ?? defaultVbsDate(getLocalDate());
  const supabase = await createClient();

  const [
    { data: statuses },
    { data: vans },
    { data: stops },
    { data: routes },
  ] = await Promise.all([
    supabase
      .from("student_day_status")
      .select("student_id, attending, mode, morning_van_id, afternoon_van_id")
      .eq("event_date", day)
      .eq("attending", true)
      .returns<StatusRow[]>(),
    supabase.from("vans").select("id, name, active").eq("active", true).order("name").returns<VanRow[]>(),
    supabase.from("stops").select("id, color_code").returns<StopRow[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<RouteRow[]>(),
  ]);

  // Only kids whose mode rides a van belong on this map (parent_both never does).
  const vanNeeding = (statuses ?? []).filter(
    (s) => ridesMorningVan(s.mode) || ridesAfternoonVan(s.mode),
  );

  const studentIds = vanNeeding.map((s) => s.student_id);
  const { data: students } = studentIds.length
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, family_id")
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const { data: families } = familyIds.length
    ? await supabase
        .from("families")
        .select("id, lat, lng, street_address, city, geocode_failed_at")
        .in("id", familyIds)
        .returns<FamilyRow[]>()
    : { data: [] as FamilyRow[] };

  const studentById = new Map((students ?? []).map((s) => [s.id, s]));
  const familyById = new Map((families ?? []).map((f) => [f.id, f]));
  const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

  // Van pickup-zone colors: resolve each van's single zone stop → its color.
  const routeList = (routes ?? []).map((r) => ({
    van_id: r.van_id,
    direction: r.direction,
    stop_ids: r.stop_ids,
  }));
  const zones: VanZone[] = (vans ?? []).map((v) => {
    const zoneStopId = zoneStopIdForVan(v.id, routeList);
    const stop = zoneStopId ? stopById.get(zoneStopId) : undefined;
    return { vanId: v.id, colorCode: stop?.color_code ?? null };
  });
  const zoneColorByVan = new Map(zones.map((z) => [z.vanId, z.colorCode]));

  const kids: KidRow[] = vanNeeding.map((s) => {
    const student = studentById.get(s.student_id);
    const family = student ? familyById.get(student.family_id) : undefined;
    const name = student
      ? (() => {
          const dn = displayName({
            preferredFirstName: student.preferred_first_name,
            legalFirstName: student.legal_first_name,
            legalLastName: student.legal_last_name,
          });
          return `${dn.first} ${dn.last}`.trim();
        })()
      : "Unknown";
    return {
      studentId: s.student_id,
      name,
      lat: family?.lat ?? null,
      lng: family?.lng ?? null,
      hasAddress: !!family?.street_address?.trim(),
      // Address on file but a prior geocode didn't match → needs fixing, not
      // re-locating. Only meaningful while un-pinned (no coords).
      geocodeFailed: !!family?.geocode_failed_at && family?.lat == null,
      street: family?.street_address ?? null,
      city: family?.city ?? null,
      // Current van for the day is DERIVED: morning leg first, else afternoon.
      currentVanId: s.morning_van_id ?? s.afternoon_van_id,
    };
  });

  const { pinnable, noAddress, locatableCount } = buildVanAssignMapData(kids, zones);

  const vanOptions = (vans ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    colorCode: zoneColorByVan.get(v.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Pickup Map</h1>
          <div className="flex items-center gap-2">
            <Link href="/coordinator/vans" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Vans
            </Link>
            <Link
              href="/coordinator/vans/map"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Live Map
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Each pin is a child&apos;s home for {day}. Check the kids you want, pick a van, and put them on
          it for door-to-door pickup. Pin color shows the van they&apos;re on now; grey means no van yet.
        </p>
      </header>

      <PickupMap
        date={day}
        pinnable={pinnable}
        noAddress={noAddress}
        locatableCount={locatableCount}
        vans={vanOptions}
      />
    </div>
  );
}
