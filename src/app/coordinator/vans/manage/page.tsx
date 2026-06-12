import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { buttonVariants } from "@/components/ui/button";
import { VanListEditor } from "./van-list-editor";
import { RouteEditor } from "./route-editor";
import { AssignmentEditor } from "./assignment-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage Vans — Coordinator" };

type VanRow = { id: string; name: string; capacity: number; plate: string | null; active: boolean };
type StopRow = { id: string; name: string; town: string; color_code: string; color_name: string };
type RouteRow = { van_id: string; direction: "am" | "pm"; stop_ids: string[] };
type AssignmentRow = { van_id: string; driver_user_id: string | null; aide_user_id: string | null };
type UserRow = { id: string; full_name: string; role: string };

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

  const [
    { data: vans },
    { data: stops },
    { data: routes },
    { data: assignments },
    { data: staff },
  ] = await Promise.all([
    supabase.from("vans").select("id, name, capacity, plate, active").order("name").returns<VanRow[]>(),
    supabase.from("stops").select("id, name, town, color_code, color_name").order("sort_order").returns<StopRow[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<RouteRow[]>(),
    supabase
      .from("van_assignments")
      .select("van_id, driver_user_id, aide_user_id")
      .eq("assignment_date", day)
      .returns<AssignmentRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, role")
      .in("role", ["driver", "aide", "coordinator", "admin"])
      .order("full_name")
      .returns<UserRow[]>(),
  ]);

  const vanList = (vans ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    capacity: v.capacity,
    plate: v.plate,
    active: v.active,
  }));
  const activeVans = vanList.filter((v) => v.active).map((v) => ({ id: v.id, name: v.name }));
  const stopList = (stops ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    town: s.town,
    colorCode: s.color_code,
    colorName: s.color_name,
  }));
  const routeList = (routes ?? []).map((r) => ({ vanId: r.van_id, direction: r.direction, stopIds: r.stop_ids }));
  const assignmentList = (assignments ?? []).map((a) => ({
    vanId: a.van_id,
    driverUserId: a.driver_user_id,
    aideUserId: a.aide_user_id,
  }));
  const staffList = (staff ?? []).map((u) => ({ id: u.id, fullName: u.full_name, role: u.role }));

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
          Create vans, set which stops each van serves (this is what puts kids on a van), and assign the
          day&apos;s driver &amp; aide.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Vans</h2>
        <VanListEditor vans={vanList} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Routes — which stops each van serves</h2>
        <p className="text-sm text-muted-foreground">
          A child rides the van whose route includes their stop. Keep each stop on just one morning route
          and one afternoon route.
        </p>
        <RouteEditor vans={activeVans} stops={stopList} routes={routeList} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Driver &amp; aide</h2>
        <AssignmentEditor date={day} vans={activeVans} assignments={assignmentList} staff={staffList} />
      </section>
    </div>
  );
}
