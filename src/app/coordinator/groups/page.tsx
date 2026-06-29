import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { displayName } from "@/lib/nametags/tag-data";
import { ageFor } from "@/lib/registration/age";
import { GroupsBuilder, type BuilderKid } from "./groups-builder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Groups — Coordinator" };

type StatusRow = { student_id: string; state: string };
type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  dob: string | null;
  age_at_registration: number | null;
};

export default async function GroupsPage({
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
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, state")
    .eq("event_date", day)
    .eq("attending", true)
    .returns<StatusRow[]>();

  const stateById = new Map((statuses ?? []).map((s) => [s.student_id, s.state]));
  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select(
          "id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, dob, age_at_registration",
        )
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const kids: BuilderKid[] = (students ?? []).map((s) => {
    const { first, last } = displayName({
      preferredFirstName: s.preferred_first_name,
      legalFirstName: s.legal_first_name,
      legalLastName: s.legal_last_name,
    });
    return {
      studentId: s.id,
      firstName: first,
      lastName: last,
      age: ageFor({ ageAtRegistration: s.age_at_registration, dob: s.dob }, day),
      wristbandCode: s.wristband_code,
      // "present" = currently checked in at the site (not just expected / on a van).
      present: stateById.get(s.id) === "site_checked_in",
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <header className="space-y-1 print:hidden">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Class groups</h1>
        <p className="text-muted-foreground text-sm">
          Build age-balanced groups from who&apos;s checked in on {day}.
        </p>
        <form className="pt-1">
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Day</span>
            <input
              type="date"
              name="date"
              defaultValue={day}
              className="rounded-md border bg-background px-3 min-h-11 md:min-h-9 text-base md:text-sm"
            />
            <button
              type="submit"
              className="rounded-md border bg-card px-3 min-h-11 md:min-h-9 text-sm hover:bg-muted/40"
            >
              Show
            </button>
          </label>
        </form>
      </header>

      <GroupsBuilder kids={kids} />
    </main>
  );
}
