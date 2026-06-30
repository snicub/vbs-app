import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { PrintButton } from "../acupuncture/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Medical & Notes — Coordinator" };

type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  allergies: string | null;
  medical_notes: string | null;
  family_id: string;
};

type FamilyRow = {
  id: string;
  primary_guardian_name: string;
  primary_phone: string;
  notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

export default async function MedicalNotesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();
  const { data: students } = await supabase
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, family_id")
    .is("archived_at", null)
    .returns<StudentRow[]>();

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const { data: families } = familyIds.length
    ? await supabase
        .from("families")
        .select("id, primary_guardian_name, primary_phone, notes, emergency_contact_name, emergency_contact_phone")
        .in("id", familyIds)
        .returns<FamilyRow[]>()
    : { data: [] as FamilyRow[] };
  const familyById = new Map((families ?? []).map((f) => [f.id, f]));

  // Anyone with a medical note, an allergy, or a family note/landmark on file.
  const rows = (students ?? [])
    .map((s) => ({ student: s, family: familyById.get(s.family_id) ?? null }))
    .filter(
      ({ student: s, family: f }) =>
        s.medical_notes?.trim() || s.allergies?.trim() || f?.notes?.trim(),
    )
    .sort(
      (a, b) =>
        a.student.legal_last_name.localeCompare(b.student.legal_last_name) ||
        a.student.legal_first_name.localeCompare(b.student.legal_first_name),
    );

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6 space-y-4 print:py-0">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Medical &amp; Notes</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} student{rows.length === 1 ? "" : "s"} with a medical note, allergy, or
            family note on file — printable.
          </p>
        </div>
        <PrintButton />
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No students have a medical note, allergy, or family note.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ student: s, family: f }) => {
            const name = `${s.preferred_first_name ?? s.legal_first_name} ${s.legal_last_name}`.trim();
            return (
              <li key={s.id} className="rounded-lg border bg-card p-4 space-y-2 break-inside-avoid">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold">{name}</h2>
                  <code className="font-mono text-xs text-muted-foreground">{s.wristband_code}</code>
                </div>

                {(s.medical_notes?.trim() || s.allergies?.trim()) && (
                  <div className="rounded-md bg-[var(--medical)]/10 border border-[var(--medical)]/30 p-2.5 text-sm">
                    {s.allergies?.trim() && (
                      <p className="whitespace-pre-wrap">
                        <span className="font-medium">Allergies:</span> {s.allergies}
                      </p>
                    )}
                    {s.medical_notes?.trim() && (
                      <p className="whitespace-pre-wrap">
                        <span className="font-medium">Medical:</span> {s.medical_notes}
                      </p>
                    )}
                  </div>
                )}

                {f?.notes?.trim() && (
                  <div className="rounded-md border bg-muted/30 p-2.5 text-sm">
                    <span className="font-medium">Note / landmark:</span> {f.notes}
                  </div>
                )}

                <div className="text-sm">
                  <span className="text-muted-foreground">Guardian: </span>
                  <span className="font-medium">{f?.primary_guardian_name ?? "—"}</span>
                  {f?.primary_phone && <span> · {f.primary_phone}</span>}
                  {f?.emergency_contact_name && (
                    <span className="text-muted-foreground">
                      {" "}
                      · Emergency: {f.emergency_contact_name}
                      {f.emergency_contact_phone ? ` ${f.emergency_contact_phone}` : ""}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
