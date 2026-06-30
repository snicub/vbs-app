import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { anomaliesFor } from "@/lib/anomaly";
import { signedUrlsFor } from "@/lib/storage/signed-url";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { RosterList, type RosterStudent } from "../../roster-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Van riders" };

const PARENT = "parent";

type Status = {
  student_id: string;
  state: string;
  attending: boolean;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  wristband_color_for_day: string | null;
  wristband_color_name: string | null;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
};
type Student = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  allergies: string | null;
  medical_notes: string | null;
  photo_path: string | null;
};

export default async function VanGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ vanId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const { vanId } = await params;
  const { date } = await searchParams;
  const day = date ?? defaultVbsDate(getLocalDate());
  const isParent = vanId === PARENT;

  const admin = createAdminClient();

  // The statuses query and the van/route/color lookup are independent (the
  // latter needs only vanId), so fetch them concurrently.
  const [{ data: statuses }, vanInfo] = await Promise.all([
    admin
      .from("student_day_status")
      .select(
        "student_id, state, attending, morning_van_id, afternoon_van_id, wristband_color_for_day, wristband_color_name, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck",
      )
      .eq("event_date", day)
      .eq("attending", true)
      .returns<Status[]>(),
    isParent
      ? Promise.resolve(null)
      : Promise.all([
          admin.from("vans").select("id, name").eq("id", vanId).maybeSingle<{ id: string; name: string }>(),
          admin.from("routes").select("van_id, direction, stop_ids").eq("van_id", vanId).returns<DirectionRoute[]>(),
          admin.from("stops").select("id, color_code").returns<{ id: string; color_code: string }[]>(),
        ]),
  ]);

  // The van a kid rides is the morning leg, falling back to the afternoon leg —
  // the same derivation the dashboard rollup groups by.
  const group = (statuses ?? []).filter((s) => {
    const v = s.morning_van_id ?? s.afternoon_van_id;
    return isParent ? v == null : v === vanId;
  });

  let groupName = "Parent drop-off";
  let groupColor: string | null = null;
  if (!isParent) {
    const [{ data: van }, { data: routes }, { data: stops }] = vanInfo!;
    if (!van) notFound();
    groupName = van.name;
    const zoneId = zoneStopIdForVan(vanId, routes ?? []);
    groupColor = zoneId ? (stops ?? []).find((s) => s.id === zoneId)?.color_code ?? null : null;
  }

  const studentIds = group.map((s) => s.student_id);
  const { data: students } = studentIds.length
    ? await admin
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, photo_path")
        .in("id", studentIds)
        .returns<Student[]>()
    : { data: [] as Student[] };

  const photoUrlMap = await signedUrlsFor("student-photos", (students ?? []).map((s) => s.photo_path));
  const statusByStudent = new Map(group.map((s) => [s.student_id, s]));

  const rosterStudents: RosterStudent[] = (students ?? [])
    .map((stu): RosterStudent => {
      const st = statusByStudent.get(stu.id)!;
      return {
        student_id: stu.id,
        state: st.state,
        name: `${stu.preferred_first_name ?? stu.legal_first_name} ${stu.legal_last_name}`.trim(),
        familyName: "",
        wristbandCode: stu.wristband_code,
        wristband_color_for_day: st.wristband_color_for_day,
        wristband_color_name: st.wristband_color_name,
        allergies: stu.allergies,
        medicalNotes: stu.medical_notes,
        photoUrl: photoUrlMap.get(stu.photo_path ?? "") ?? null,
        anomalies: anomaliesFor({
          isLateAm: st.is_late_am,
          isBoardedButNotArrived: st.is_boarded_but_not_arrived,
          isInButNotOut: st.is_in_but_not_out,
          isPmVanStuck: st.is_pm_van_stuck,
        }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const homeCount = group.filter((s) => s.state === "home").length;

  return (
    <main className="mx-auto max-w-2xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <Link
        href={`/coordinator?date=${day}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-11"
      >
        <ArrowLeftIcon className="size-4" /> Back to dashboard
      </Link>

      <header className="flex items-center gap-3">
        <span
          className="size-6 rounded-full border shrink-0"
          style={{ backgroundColor: groupColor ?? "var(--muted)" }}
          aria-hidden
        />
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{groupName}</h1>
          <p className="text-sm text-muted-foreground">
            {rosterStudents.length} kid{rosterStudents.length === 1 ? "" : "s"} · {homeCount} home · tap a name to check in / out
          </p>
        </div>
      </header>

      {rosterStudents.length === 0 ? (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          No kids on this van today.
        </p>
      ) : (
        <RosterList students={rosterStudents} />
      )}
    </main>
  );
}
