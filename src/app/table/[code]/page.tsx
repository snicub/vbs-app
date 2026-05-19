import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canCheckIn, isCoordinator } from "@/lib/auth/roles";
import { lookupByWristband } from "@/server-actions/events";
import { signedUrlFor } from "@/lib/storage/signed-url";
import { createClient } from "@/lib/supabase/server";
import { StudentActions } from "./student-actions";
import { ChangeStopsPanel } from "./change-stops";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StudentTablePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canCheckIn(user.role)) {
    return <main className="p-6 text-sm">Not permitted.</main>;
  }

  const result = await lookupByWristband({ code });
  if (!result.ok) notFound();

  const { student, status } = result;
  const state = (status?.state ?? "not_started") as DayState;
  const photoUrl = await signedUrlFor("student-photos", student.photoPath);

  const supabase = await createClient();

  // Family contacts (always shown to anyone with check-in access)
  const { data: family } = await supabase
    .from("families")
    .select("primary_guardian_name, primary_email, primary_phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship")
    .eq("id", student.familyId)
    .maybeSingle<{
      primary_guardian_name: string;
      primary_email: string;
      primary_phone: string;
      emergency_contact_name: string | null;
      emergency_contact_phone: string | null;
      emergency_contact_relationship: string | null;
    }>();

  const { data: guardians } = await supabase
    .from("guardians")
    .select("full_name, email, phone, relationship")
    .eq("family_id", student.familyId)
    .returns<{ full_name: string; email: string | null; phone: string | null; relationship: string | null }[]>();

  let stops: { id: string; name: string; town: string; colorName: string }[] = [];
  if (isCoordinator(user.role)) {
    const { data } = await supabase
      .from("stops")
      .select("id, name, town, color_name")
      .order("sort_order")
      .returns<{ id: string; name: string; town: string; color_name: string }[]>();
    stops = (data ?? []).map((s) => ({
      id: s.id, name: s.name, town: s.town, colorName: s.color_name,
    }));
  }

  return (
    <main className="mx-auto max-w-2xl px-3 sm:px-4 py-6 space-y-5">
      <Link href="/table" className="text-sm text-muted-foreground hover:underline">
        ← Back to search
      </Link>

      <div className="flex items-start gap-4">
        <div className="h-24 w-24 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={student.legalFirstName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground text-center">No photo</span>
          )}
        </div>
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">
            {student.preferredFirstName ?? student.legalFirstName} {student.legalLastName}
          </h1>
          <div className="text-sm text-muted-foreground">
            <code className="font-mono">{student.wristbandCode}</code>
            {status?.wristbandColorName && <> · color {status.wristbandColorName}</>}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          Current status
        </div>
        <div className="mt-1 text-lg font-semibold">{STATE_LABEL[state]}</div>
      </div>

      {(student.allergies || student.medicalNotes) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm space-y-2 dark:bg-amber-900/20">
          {student.allergies && (
            <p><strong>Allergies:</strong> {student.allergies}</p>
          )}
          {student.medicalNotes && (
            <p><strong>Medical:</strong> {student.medicalNotes}</p>
          )}
        </div>
      )}

      {/* Family contacts — always visible to staff for emergencies */}
      {family && (
        <div className="rounded-lg border bg-card p-3 text-sm space-y-2">
          <div className="text-xs uppercase text-muted-foreground tracking-wide">
            Contact
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <strong>{family.primary_guardian_name}</strong>
              <a href={`tel:${family.primary_phone}`} className="text-primary hover:underline">
                {family.primary_phone}
              </a>
              <span className="text-muted-foreground">·</span>
              <a href={`mailto:${family.primary_email}`} className="text-primary hover:underline">
                {family.primary_email}
              </a>
            </div>
            {(guardians ?? []).filter((g) => g.full_name !== family.primary_guardian_name).map((g, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap text-muted-foreground">
                <span>{g.full_name}{g.relationship ? ` (${g.relationship})` : ""}</span>
                {g.phone && (
                  <a href={`tel:${g.phone}`} className="text-primary hover:underline">{g.phone}</a>
                )}
                {g.email && (
                  <a href={`mailto:${g.email}`} className="text-primary hover:underline">{g.email}</a>
                )}
              </div>
            ))}
            {family.emergency_contact_name && (
              <div className="pt-1 border-t mt-1 text-muted-foreground">
                <span className="text-xs uppercase tracking-wide">Emergency:</span>{" "}
                <strong className="text-foreground">{family.emergency_contact_name}</strong>
                {family.emergency_contact_relationship && (
                  <span> ({family.emergency_contact_relationship})</span>
                )}
                {family.emergency_contact_phone && (
                  <>
                    {" — "}
                    <a href={`tel:${family.emergency_contact_phone}`} className="text-primary hover:underline">
                      {family.emergency_contact_phone}
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isCoordinator(user.role) && status && (
        <ChangeStopsPanel
          studentId={student.id}
          eventDate={status.eventDate}
          currentMorningStopId={status.morningStopId}
          currentAfternoonStopId={status.afternoonStopId}
          stops={stops}
        />
      )}

      <StudentActions
        studentId={student.id}
        eventDate={status?.eventDate ?? new Date().toISOString().slice(0, 10)}
        currentState={state}
        actorRole={user.role}
      />
    </main>
  );
}
