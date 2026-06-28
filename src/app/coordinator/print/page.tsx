import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import {
  buildVanManifests,
  buildRoster,
  type StatusInput,
  type StudentInput,
  type StopInfo,
  type FamilyInfo,
  type VanInfo,
} from "@/lib/failsafe/print-data";
import { PrintFailsafe } from "./print-failsafe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print / Failsafe — Coordinator" };

type StatusRow = {
  student_id: string;
  attending: boolean;
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
  age_at_registration: number | null;
  dob: string | null;
  allergies: string | null;
  medical_notes: string | null;
  family_id: string;
};
type StopRow = {
  id: string;
  name: string;
  town: string;
  color_code: string;
  color_name: string;
  sort_order: number;
};
type VanRow = { id: string; name: string };
type FamilyRow = {
  id: string;
  primary_guardian_name: string;
  primary_phone: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

export default async function PrintFailsafePage({
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
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(
      "student_id, attending, mode, morning_stop_id, afternoon_stop_id, morning_van_id, afternoon_van_id, wristband_color_for_day, wristband_color_name",
    )
    .eq("event_date", day)
    .eq("attending", true)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select(
          "id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, age_at_registration, dob, allergies, medical_notes, family_id",
        )
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const { data: families } = familyIds.length > 0
    ? await supabase
        .from("families")
        .select(
          "id, primary_guardian_name, primary_phone, street_address, city, state, postal_code, emergency_contact_name, emergency_contact_phone",
        )
        .in("id", familyIds)
        .returns<FamilyRow[]>()
    : { data: [] as FamilyRow[] };

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, town, color_code, color_name, sort_order")
    .order("sort_order")
    .returns<StopRow[]>();

  const { data: vans } = await supabase
    .from("vans")
    .select("id, name")
    .eq("active", true)
    .order("name")
    .returns<VanRow[]>();

  const statusInputs: StatusInput[] = (statuses ?? []).map((s) => ({
    studentId: s.student_id,
    attending: s.attending,
    mode: s.mode,
    morningStopId: s.morning_stop_id,
    afternoonStopId: s.afternoon_stop_id,
    morningVanId: s.morning_van_id,
    afternoonVanId: s.afternoon_van_id,
    wristbandColorForDay: s.wristband_color_for_day,
    wristbandColorName: s.wristband_color_name,
  }));

  const studentMap = new Map<string, StudentInput>(
    (students ?? []).map((s) => [
      s.id,
      {
        legalFirstName: s.legal_first_name,
        legalLastName: s.legal_last_name,
        preferredFirstName: s.preferred_first_name,
        wristbandCode: s.wristband_code,
        ageAtRegistration: s.age_at_registration,
        dob: s.dob,
        allergies: s.allergies,
        medicalNotes: s.medical_notes,
        familyId: s.family_id,
      },
    ]),
  );
  const stopMap = new Map<string, StopInfo>(
    (stops ?? []).map((s) => [
      s.id,
      {
        name: s.name,
        town: s.town,
        colorCode: s.color_code,
        colorName: s.color_name,
        sortOrder: s.sort_order,
      },
    ]),
  );
  const familyMap = new Map<string, FamilyInfo>(
    (families ?? []).map((f) => {
      const streetLine = f.street_address?.trim() || "";
      const cityStateZip = [f.city, f.state, f.postal_code]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(", ");
      const address = [streetLine, cityStateZip].filter(Boolean).join(", ");
      return [
        f.id,
        {
          guardianName: f.primary_guardian_name,
          guardianPhone: f.primary_phone,
          address,
          emergencyName: f.emergency_contact_name,
          emergencyPhone: f.emergency_contact_phone,
        },
      ];
    }),
  );
  // Vans have no stored order; the query is already name-sorted, so use the
  // row index as the manifest order.
  const vanInfoMap = new Map<string, VanInfo>(
    (vans ?? []).map((v, i) => [v.id, { name: v.name, sortOrder: i }]),
  );
  const vanList = (vans ?? []).map((v, i) => ({
    id: v.id,
    name: v.name,
    sortOrder: i,
  }));

  const manifests = buildVanManifests(statusInputs, studentMap, stopMap, familyMap, vanList);
  const roster = buildRoster(statusInputs, studentMap, stopMap, familyMap, vanInfoMap, day);

  return <PrintFailsafe date={day} manifests={manifests} roster={roster} />;
}
