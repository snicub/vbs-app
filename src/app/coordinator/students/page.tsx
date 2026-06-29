import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { signedUrlsFor } from "@/lib/storage/signed-url";
import { ageFor } from "@/lib/registration/age";
import { StudentsTable, type StudentRow } from "./students-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Students — Coordinator" };

type StudentDbRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  dob: string | null;
  age_at_registration: number | null;
  allergies: string | null;
  medical_notes: string | null;
  photo_path: string | null;
  families: { primary_guardian_name: string; primary_phone: string } | null;
};

type DayStatusRow = {
  student_id: string;
  state: string;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
};

type StopRow = { id: string; name: string; town: string };

export default async function StudentsDashboardPage() {
  const supabase = await createClient();
  const today = getLocalDate();

  const { data: students } = await supabase
    .from("students")
    .select(
      `id, legal_first_name, legal_last_name, preferred_first_name, wristband_code,
       dob, age_at_registration, allergies, medical_notes, photo_path,
       families(primary_guardian_name, primary_phone)`,
    )
    .is("archived_at", null)
    .order("legal_last_name")
    .returns<StudentDbRow[]>();

  const { data: archived } = await supabase
    .from("students")
    .select(
      `id, legal_first_name, legal_last_name, preferred_first_name, wristband_code,
       dob, age_at_registration, allergies, medical_notes, photo_path,
       families(primary_guardian_name, primary_phone)`,
    )
    .not("archived_at", "is", null)
    .order("legal_last_name")
    .returns<StudentDbRow[]>();

  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, state, morning_stop_id, afternoon_stop_id")
    .eq("event_date", today)
    .returns<DayStatusRow[]>();

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, town")
    .returns<StopRow[]>();
  const stopMap = new Map((stops ?? []).map((s) => [s.id, s]));

  const statusMap = new Map((statuses ?? []).map((s) => [s.student_id, s]));

  // Batch-sign all photo URLs in a single round-trip, keyed by photo path.
  const photoUrls = await signedUrlsFor(
    "student-photos",
    [...(students ?? []), ...(archived ?? [])].map((s) => s.photo_path),
  );

  function toRow(s: StudentDbRow): StudentRow {
    const status = statusMap.get(s.id);
    const morningStop = status?.morning_stop_id
      ? stopMap.get(status.morning_stop_id)
      : undefined;
    const afternoonStop = status?.afternoon_stop_id
      ? stopMap.get(status.afternoon_stop_id)
      : undefined;
    return {
      id: s.id,
      photoUrl: (s.photo_path ? photoUrls.get(s.photo_path) : null) ?? null,
      firstName: s.preferred_first_name ?? s.legal_first_name,
      lastName: s.legal_last_name,
      wristbandCode: s.wristband_code,
      dob: s.dob,
      ageAtRegistration: s.age_at_registration,
      age: ageFor({ ageAtRegistration: s.age_at_registration, dob: s.dob }, today),
      allergies: s.allergies,
      medicalNotes: s.medical_notes,
      familyName: s.families?.primary_guardian_name ?? "—",
      familyPhone: s.families?.primary_phone ?? "",
      state: status?.state ?? "not_started",
      morningStop: morningStop ? `${morningStop.name} (${morningStop.town})` : "",
      afternoonStop: afternoonStop ? `${afternoonStop.name} (${afternoonStop.town})` : "",
    };
  }

  const rows: StudentRow[] = (students ?? []).map(toRow);
  const archivedRows: StudentRow[] = (archived ?? []).map(toRow);

  return (
    <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Students</h1>
        <p className="text-muted-foreground text-sm">
          {rows.length} registered · search and sort across all kids
        </p>
      </header>
      <StudentsTable rows={rows} archivedRows={archivedRows} />
    </main>
  );
}
