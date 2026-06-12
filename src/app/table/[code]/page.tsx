import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canCheckIn, isCoordinator } from "@/lib/auth/roles";
import { lookupByWristband } from "@/server-actions/events";
import { signedUrlFor } from "@/lib/storage/signed-url";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { safeDayState } from "@/lib/state-presentation";
import { StudentActions } from "./student-actions";
import { ChangeStopsPanel } from "./change-stops";
import { FamilyAccessPanel } from "./family-access-panel";
import { STATE_PRESENTATION, TONE_CLASSES } from "@/lib/state-presentation";
import { StateBadge, SafetyCallout } from "@/components/state-badge";
import Link from "next/link";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

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
  const state = safeDayState(status?.state ?? "not_started");
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

  // Authorized pickup persons — including restricted entries ("do NOT release
  // to"). We display restricted as a loud banner; allowed entries become the
  // pickup-person picker for parent-pickup events.
  const { data: pickupPersons } = await supabase
    .from("authorized_pickup_persons")
    .select("id, full_name, phone, relationship, is_restricted, notes")
    .eq("family_id", student.familyId)
    .order("is_restricted", { ascending: false })
    .order("full_name")
    .returns<{
      id: string;
      full_name: string;
      phone: string | null;
      relationship: string | null;
      is_restricted: boolean;
      notes: string | null;
    }[]>();

  const restrictedPickup = (pickupPersons ?? []).filter((p) => p.is_restricted);
  const allowedPickup = (pickupPersons ?? []).filter((p) => !p.is_restricted);

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

  const presentation = STATE_PRESENTATION[state];
  const tone = TONE_CLASSES[presentation.tone];

  return (
    <main className="mx-auto max-w-2xl px-3 sm:px-4 py-4 sm:py-6 space-y-5">
      <Link
        href="/table"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-11"
      >
        <ArrowLeftIcon className="size-4" /> Back to search
      </Link>

      <div className="flex items-start gap-4">
        <div className="h-24 w-24 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={student.legalFirstName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground text-center">No photo</span>
          )}
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <h1 className="text-2xl font-semibold truncate">
            {student.preferredFirstName ?? student.legalFirstName} {student.legalLastName}
          </h1>
          <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <code className="font-mono">{student.wristbandCode}</code>
            {status?.wristbandColorName && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  Wristband
                  {status.wristbandColorHex && (
                    <span
                      className="inline-block w-4 h-4 rounded-full border ring-1 ring-border"
                      style={{ backgroundColor: status.wristbandColorHex }}
                      aria-hidden
                    />
                  )}
                  {status.wristbandColorName}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status card — full-bleed accent in the state's tone */}
      <div
        className={cn("rounded-xl border-l-4 border bg-card p-4 flex items-center gap-3")}
        style={{ borderLeftColor: `var(--state-${presentation.tone})` }}
      >
        <presentation.icon className={cn("size-7", tone.icon)} aria-hidden />
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Current status
          </div>
          <div className="text-xl font-semibold leading-tight">
            {presentation.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {presentation.description}
          </div>
        </div>
        <div className="ml-auto hidden sm:block">
          <StateBadge state={state} size="lg" />
        </div>
      </div>

      {/* Restricted-pickup banner — loud, above everything else. If a court
          order, custody dispute, or DV concern is on file, the volunteer
          MUST see this before doing any pickup action. */}
      {restrictedPickup.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border-2 p-4 space-y-2"
          style={{
            borderColor: "var(--destructive)",
            backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <span aria-hidden>⛔</span>
            DO NOT RELEASE to the following ({restrictedPickup.length}):
          </div>
          <ul className="space-y-1.5 text-sm">
            {restrictedPickup.map((p) => (
              <li key={p.id} className="font-medium">
                <strong>{p.full_name}</strong>
                {p.relationship && (
                  <span className="text-muted-foreground"> ({p.relationship})</span>
                )}
                {p.notes && (
                  <div className="text-xs text-muted-foreground font-normal mt-0.5">
                    {p.notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="text-xs text-destructive font-medium pt-1 border-t border-destructive/30">
            If any of these people are here, do NOT release the student.
            Call the coordinator immediately.
          </div>
        </div>
      )}

      <SafetyCallout
        allergies={student.allergies}
        medicalNotes={student.medicalNotes}
      />

      <StudentActions
        studentId={student.id}
        eventDate={status?.eventDate ?? getLocalDate()}
        currentState={state}
        actorRole={user.role}
        mode={(status?.mode as "van" | "parent_dropoff_only" | "parent_pickup_only" | "parent_both" | null) ?? null}
        primaryGuardianName={family?.primary_guardian_name ?? null}
        emergencyContact={
          family?.emergency_contact_name
            ? {
                name: family.emergency_contact_name,
                relationship: family.emergency_contact_relationship,
              }
            : null
        }
        guardians={(guardians ?? []).map((g) => ({
          fullName: g.full_name,
          relationship: g.relationship,
        }))}
        authorizedPickup={allowedPickup.map((p) => ({
          id: p.id,
          fullName: p.full_name,
          relationship: p.relationship,
        }))}
      />

      {/* Family contacts — below action buttons so volunteers reach check-in faster */}
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

      {isCoordinator(user.role) && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/coordinator/students/${student.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <PencilIcon /> Edit student / family info
          </Link>
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

      {isCoordinator(user.role) && (
        <FamilyAccessPanel familyId={student.familyId} />
      )}
    </main>
  );
}
