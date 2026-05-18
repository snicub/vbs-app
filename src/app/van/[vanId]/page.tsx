import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canDriveVan } from "@/lib/auth/roles";
import { VanManifest } from "./van-manifest";

export const dynamic = "force-dynamic";

type StatusRow = {
  student_id: string;
  event_date: string;
  state: string;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  wristband_color_name: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
};

type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  allergies: string | null;
  medical_notes: string | null;
};

export default async function VanPage({
  params,
}: {
  params: Promise<{ vanId: string }>;
}) {
  const { vanId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canDriveVan(user.role)) {
    return <main className="p-6 text-sm">Not permitted.</main>;
  }

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: van } = await supabase
    .from("vans")
    .select("id, name")
    .eq("id", vanId)
    .maybeSingle<{ id: string; name: string }>();
  if (!van) notFound();

  // Get today's statuses for kids on this van (AM or PM)
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(
      "student_id, event_date, state, morning_van_id, afternoon_van_id, wristband_color_name, morning_stop_id, afternoon_stop_id",
    )
    .eq("event_date", today)
    .or(`morning_van_id.eq.${vanId},afternoon_van_id.eq.${vanId}`)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  let students: StudentRow[] = [];
  if (studentIds.length > 0) {
    const { data: studentRows } = await supabase
      .from("students")
      .select(
        "id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes",
      )
      .in("id", studentIds)
      .returns<StudentRow[]>();
    students = studentRows ?? [];
  }

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, color_name")
    .returns<{ id: string; name: string; color_name: string }[]>();
  const stopMap = new Map((stops ?? []).map((s) => [s.id, s]));

  const roster = (statuses ?? []).map((status) => {
    const student = students.find((s) => s.id === status.student_id);
    const direction: "am" | "pm" | "both" =
      status.morning_van_id === vanId && status.afternoon_van_id === vanId
        ? "both"
        : status.morning_van_id === vanId
          ? "am"
          : "pm";
    return {
      studentId: status.student_id,
      eventDate: status.event_date,
      state: status.state,
      name: student
        ? `${student.preferred_first_name ?? student.legal_first_name} ${student.legal_last_name}`
        : "(unknown)",
      wristbandCode: student?.wristband_code ?? "",
      colorName: status.wristband_color_name,
      allergies: student?.allergies ?? null,
      medicalNotes: student?.medical_notes ?? null,
      direction,
      stopName:
        (status.morning_van_id === vanId
          ? stopMap.get(status.morning_stop_id ?? "")?.name
          : stopMap.get(status.afternoon_stop_id ?? "")?.name) ?? null,
    };
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{van.name} — manifest</h1>
        <p className="text-muted-foreground text-sm">
          {today} · {roster.length} student{roster.length === 1 ? "" : "s"}
        </p>
      </header>

      <VanManifest vanId={vanId} eventDate={today} roster={roster} />
    </main>
  );
}
