import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { canCheckIn } from "@/lib/auth/roles";
import { TableCheckinList, type CheckinRow } from "./table-checkin-list";

export const metadata = { title: "Check-In Table — VBS" };
export const dynamic = "force-dynamic";

export default async function TablePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canCheckIn(user.role)) {
    return (
      <main className="p-6 max-w-md mx-auto text-sm">
        <h1 className="text-lg font-semibold mb-2">Not permitted</h1>
        <p>You don&apos;t have access to the check-in table.</p>
      </main>
    );
  }

  const day = defaultVbsDate(getLocalDate());
  const supabase = await createClient();

  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, state")
    .eq("event_date", day)
    .eq("attending", true)
    .returns<{ student_id: string; state: string }[]>();

  const ids = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = ids.length
    ? await supabase
        .from("students")
        .select(
          "id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, family_id",
        )
        .in("id", ids)
        .returns<
          {
            id: string;
            legal_first_name: string;
            legal_last_name: string;
            preferred_first_name: string | null;
            wristband_code: string;
            allergies: string | null;
            medical_notes: string | null;
            family_id: string;
          }[]
        >()
    : { data: [] as never[] };

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const { data: families } = familyIds.length
    ? await supabase
        .from("families")
        .select("id, primary_guardian_name")
        .in("id", familyIds)
        .returns<{ id: string; primary_guardian_name: string }[]>()
    : { data: [] as { id: string; primary_guardian_name: string }[] };

  const familyName = new Map((families ?? []).map((f) => [f.id, f.primary_guardian_name]));
  const stateByStudent = new Map((statuses ?? []).map((s) => [s.student_id, s.state]));

  const rows: CheckinRow[] = (students ?? [])
    .map((s) => ({
      id: s.id,
      code: s.wristband_code,
      name: `${s.preferred_first_name ?? s.legal_first_name} ${s.legal_last_name}`.trim(),
      family: familyName.get(s.family_id) ?? "",
      state: stateByStudent.get(s.id) ?? "not_started",
      allergies: s.allergies,
      medicalNotes: s.medical_notes,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Check-In Table</h1>
        <p className="text-muted-foreground text-sm">
          Tap a child when they arrive at the building to check them in. Search by name or family.
        </p>
      </header>
      <TableCheckinList rows={rows} />
    </main>
  );
}
