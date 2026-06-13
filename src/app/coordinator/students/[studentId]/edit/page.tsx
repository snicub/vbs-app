import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { getLocalDate } from "@/lib/date";
import { signedUrlFor } from "@/lib/storage/signed-url";
import { ArrowLeftIcon } from "lucide-react";
import { StudentEditForm } from "./student-edit-form";
import { FamilyContactsForm } from "./family-contacts-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("legal_first_name, legal_last_name")
    .eq("id", studentId)
    .maybeSingle<{ legal_first_name: string; legal_last_name: string }>();
  const name = data
    ? [data.legal_first_name, data.legal_last_name].filter(Boolean).join(" ")
    : "Student";
  return { title: `Edit ${name} — Coordinator` };
}

type StudentDb = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  allergies: string | null;
  medical_notes: string | null;
  wristband_code: string;
  photo_path: string | null;
  family_id: string;
};

type DayRecordDb = {
  id: string;
  event_date: string;
  mode: string;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  attending: boolean;
};

type StopDb = {
  id: string;
  name: string;
  town: string;
  color_name: string;
};

type FamilyDb = {
  id: string;
  primary_guardian_name: string;
  primary_email: string;
  primary_phone: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
};

type GuardianDb = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
};

export default async function StudentEditPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();

  const { data: student } = await supabase
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, allergies, medical_notes, wristband_code, photo_path, family_id")
    .eq("id", studentId)
    .maybeSingle<StudentDb>();

  if (!student) notFound();

  const today = getLocalDate();

  const [dayRecordRes, stopsRes, familyRes, guardiansRes] = await Promise.all([
    supabase
      .from("student_day_records")
      .select("id, event_date, mode, morning_stop_id, afternoon_stop_id, attending")
      .eq("student_id", studentId)
      .eq("event_date", today)
      .maybeSingle<DayRecordDb>(),
    supabase
      .from("stops")
      .select("id, name, town, color_name")
      .order("sort_order")
      .returns<StopDb[]>(),
    supabase
      .from("families")
      .select("id, primary_guardian_name, primary_email, primary_phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
      .eq("id", student.family_id)
      .maybeSingle<FamilyDb>(),
    createAdminClient()
      .from("guardians")
      .select("id, full_name, email, phone, relationship")
      .eq("family_id", student.family_id)
      .returns<GuardianDb[]>(),
  ]);

  const dayRecord = dayRecordRes.data;
  const stops = (stopsRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    town: s.town,
    colorName: s.color_name,
  }));
  const family = familyRes.data;
  const guardians = guardiansRes.data ?? [];

  const photoUrl = await signedUrlFor("student-photos", student.photo_path);
  const fullName = [student.legal_first_name, student.legal_last_name].filter(Boolean).join(" ");

  return (
    <main className="mx-auto max-w-2xl px-3 sm:px-4 py-4 sm:py-6 space-y-6">
      <Link
        href={`/table/${student.wristband_code}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-9"
      >
        <ArrowLeftIcon className="size-4" /> Back to {fullName}
      </Link>

      <div className="flex items-start gap-4">
        <div className="h-16 w-16 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={fullName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground text-center">No photo</span>
          )}
        </div>
        <div className="space-y-0.5 min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">
            Edit: {fullName}
          </h1>
          <div className="text-sm text-muted-foreground">
            <code className="font-mono">{student.wristband_code}</code>
          </div>
        </div>
      </div>

      <StudentEditForm
        studentId={student.id}
        eventDate={today}
        initialName={fullName}
        initialAllergies={student.allergies ?? ""}
        initialMedicalNotes={student.medical_notes ?? ""}
        initialMode={dayRecord?.mode ?? null}
        initialMorningStopId={dayRecord?.morning_stop_id ?? null}
        initialAfternoonStopId={dayRecord?.afternoon_stop_id ?? null}
        initialAttending={dayRecord?.attending ?? true}
        hasDayRecord={!!dayRecord}
        stops={stops}
      />

      {family && (
        <FamilyContactsForm
          familyId={family.id}
          initialPrimaryPhone={family.primary_phone}
          initialEmergencyContactName={family.emergency_contact_name ?? ""}
          initialEmergencyContactPhone={family.emergency_contact_phone ?? ""}
          initialEmergencyContactRelationship={family.emergency_contact_relationship ?? ""}
          guardians={guardians.map((g) => ({
            id: g.id,
            fullName: g.full_name,
            email: g.email,
            phone: g.phone,
            relationship: g.relationship,
          }))}
          primaryGuardianName={family.primary_guardian_name}
          primaryEmail={family.primary_email}
        />
      )}
    </main>
  );
}
