import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { buildTagData, sortTags } from "@/lib/nametags/tag-data";
import { NameTagSheet } from "./nametag-sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Name Tags — Coordinator" };

type StatusRow = {
  student_id: string;
  mode: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  wristband_color_for_day: string | null;
  wristband_color_name: string | null;
};
type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
};
type StopRow = {
  id: string;
  name: string;
  town: string;
  color_code: string | null;
  color_name: string | null;
};
type VanRow = { id: string; name: string };

export default async function NameTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; town?: string; van?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const { date, town, van } = await searchParams;
  const day = date ?? defaultVbsDate(getLocalDate());

  const supabase = await createClient();
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(
      "student_id, mode, morning_stop_id, afternoon_stop_id, morning_van_id, afternoon_van_id, wristband_color_for_day, wristband_color_name",
    )
    .eq("event_date", day)
    .eq("attending", true)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, town, color_code, color_name")
    .order("sort_order")
    .returns<StopRow[]>();

  const { data: vans } = await supabase
    .from("vans")
    .select("id, name")
    .returns<VanRow[]>();

  const studentMap = new Map(
    (students ?? []).map((s) => [
      s.id,
      {
        legalFirstName: s.legal_first_name,
        legalLastName: s.legal_last_name,
        preferredFirstName: s.preferred_first_name,
        wristbandCode: s.wristband_code,
      },
    ]),
  );
  const stopMap = new Map(
    (stops ?? []).map((s) => [
      s.id,
      { name: s.name, town: s.town, colorCode: s.color_code, colorName: s.color_name },
    ]),
  );
  const vanMap = new Map((vans ?? []).map((v) => [v.id, v.name]));

  const allTags = sortTags(
    buildTagData(
      (statuses ?? []).map((s) => ({
        studentId: s.student_id,
        mode: s.mode,
        morningStopId: s.morning_stop_id,
        afternoonStopId: s.afternoon_stop_id,
        morningVanId: s.morning_van_id,
        afternoonVanId: s.afternoon_van_id,
        wristbandColorForDay: s.wristband_color_for_day,
        wristbandColorName: s.wristband_color_name,
      })),
      studentMap,
      stopMap,
      vanMap,
    ),
  );

  // Filter server-side so the printed sheet matches the on-screen selection.
  const tags = allTags.filter((t) => {
    if (town && t.town !== town) return false;
    if (van && t.vanName !== van) return false;
    return true;
  });

  return (
    <NameTagSheet
      tags={tags}
      date={day}
      town={town ?? ""}
      van={van ?? ""}
      towns={Array.from(new Set((stops ?? []).map((s) => s.town)))}
      vans={(vans ?? []).map((v) => v.name)}
    />
  );
}
