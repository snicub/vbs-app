import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { matchesAcupuncture } from "@/lib/medical/acupuncture";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acupuncture — Coordinator" };

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
  primary_email: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
};

export default async function AcupuncturePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();

  // Scan every active student's notes for an acupuncture mention. Fuzzy matching
  // (misspellings, hyphens) can't be a SQL filter, so we pull the small note set
  // and match in JS. Archived students are excluded.
  const { data: students } = await supabase
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, family_id")
    .is("archived_at", null)
    .or("medical_notes.not.is.null,allergies.not.is.null")
    .returns<StudentRow[]>();

  const matched = (students ?? []).filter((s) => matchesAcupuncture(s.medical_notes, s.allergies));

  const familyIds = Array.from(new Set(matched.map((s) => s.family_id)));
  const { data: families } = familyIds.length
    ? await supabase
        .from("families")
        .select("id, primary_guardian_name, primary_phone, primary_email, street_address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
        .in("id", familyIds)
        .returns<FamilyRow[]>()
    : { data: [] as FamilyRow[] };
  const familyById = new Map((families ?? []).map((f) => [f.id, f]));

  const rows = matched
    .map((s) => ({ student: s, family: familyById.get(s.family_id) ?? null }))
    .sort((a, b) =>
      a.student.legal_last_name.localeCompare(b.student.legal_last_name) ||
      a.student.legal_first_name.localeCompare(b.student.legal_first_name),
    );

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6 space-y-4 print:py-0">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Acupuncture</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} student{rows.length === 1 ? "" : "s"} whose medical notes mention
            acupuncture. Full note, contacts, and address below — printable.
          </p>
        </div>
        <PrintButton />
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No students mention acupuncture in their medical notes.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ student: s, family: f }) => {
            const name = `${s.preferred_first_name ?? s.legal_first_name} ${s.legal_last_name}`.trim();
            const cityLine = [f?.city, f?.state, f?.postal_code]
              .map((p) => p?.trim())
              .filter(Boolean)
              .join(", ");
            const address = [f?.street_address?.trim(), cityLine].filter(Boolean).join(" · ");
            return (
              <li
                key={s.id}
                className="rounded-lg border bg-card p-4 space-y-2 break-inside-avoid"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold">{name}</h2>
                  <code className="font-mono text-xs text-muted-foreground">{s.wristband_code}</code>
                </div>

                <div className="rounded-md bg-[var(--medical)]/10 border border-[var(--medical)]/30 p-2.5 text-sm">
                  <div className="text-xs uppercase tracking-wide text-[var(--medical)] font-semibold mb-0.5">
                    Medical note
                  </div>
                  {s.medical_notes && <p className="whitespace-pre-wrap">{s.medical_notes}</p>}
                  {s.allergies && (
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium">Allergies:</span> {s.allergies}
                    </p>
                  )}
                </div>

                <div className="text-sm space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Guardian: </span>
                    <span className="font-medium">{f?.primary_guardian_name ?? "—"}</span>
                    {f?.primary_phone && <span> · {f.primary_phone}</span>}
                    {f?.primary_email && <span> · {f.primary_email}</span>}
                  </div>
                  {f?.emergency_contact_name && (
                    <div>
                      <span className="text-muted-foreground">Emergency: </span>
                      {f.emergency_contact_name}
                      {f.emergency_contact_relationship && ` (${f.emergency_contact_relationship})`}
                      {f.emergency_contact_phone && ` · ${f.emergency_contact_phone}`}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Address: </span>
                    {address || "—"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
