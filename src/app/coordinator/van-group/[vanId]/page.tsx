import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { safeDayState } from "@/lib/state-presentation";
import { signedUrlsFor } from "@/lib/storage/signed-url";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { StateBadge, SafetyCallout } from "@/components/state-badge";
import { StudentActions } from "@/app/table/[code]/student-actions";
import { Avatar } from "../../roster-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Van group — check in / out" };

const PARENT = "parent";

type Status = {
  student_id: string;
  state: string;
  mode: string | null;
  attending: boolean;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
};
type Student = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  allergies: string | null;
  medical_notes: string | null;
  photo_path: string | null;
  family_id: string;
};
type Family = {
  id: string;
  primary_guardian_name: string;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
};
type Guardian = { family_id: string; full_name: string; relationship: string | null };
type Pickup = {
  id: string;
  family_id: string;
  full_name: string;
  relationship: string | null;
  is_restricted: boolean;
  notes: string | null;
};

export default async function VanGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ vanId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const { vanId } = await params;
  const { date } = await searchParams;
  const day = date ?? defaultVbsDate(getLocalDate());
  const isParent = vanId === PARENT;

  // Coordinator-gated, so read RLS-free (matches the other coordinator screens) —
  // we need every kid's contacts + pickup people to drive the release controls.
  const admin = createAdminClient();

  // The statuses query and the van/route/color lookup are independent (the
  // latter needs only vanId), so fetch them concurrently.
  const [{ data: statuses }, vanInfo] = await Promise.all([
    admin
      .from("student_day_status")
      .select("student_id, state, mode, attending, morning_van_id, afternoon_van_id")
      .eq("event_date", day)
      .eq("attending", true)
      .returns<Status[]>(),
    isParent
      ? Promise.resolve(null)
      : Promise.all([
          admin.from("vans").select("id, name").eq("id", vanId).maybeSingle<{ id: string; name: string }>(),
          admin.from("routes").select("van_id, direction, stop_ids").eq("van_id", vanId).returns<DirectionRoute[]>(),
          admin.from("stops").select("id, color_code").returns<{ id: string; color_code: string }[]>(),
        ]),
  ]);

  // The van a kid rides is the morning leg, falling back to the afternoon leg —
  // the same derivation the dashboard rollup groups by.
  const group = (statuses ?? []).filter((s) => {
    const v = s.morning_van_id ?? s.afternoon_van_id;
    return isParent ? v == null : v === vanId;
  });

  let groupName = "Parent drop-off";
  let groupColor: string | null = null;
  if (!isParent) {
    const [{ data: van }, { data: routes }, { data: stops }] = vanInfo!;
    if (!van) notFound();
    groupName = van.name;
    const zoneId = zoneStopIdForVan(vanId, routes ?? []);
    groupColor = zoneId ? (stops ?? []).find((s) => s.id === zoneId)?.color_code ?? null : null;
  }

  const studentIds = group.map((s) => s.student_id);
  const { data: students } = studentIds.length
    ? await admin
        .from("students")
        .select(
          "id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, photo_path, family_id",
        )
        .in("id", studentIds)
        .returns<Student[]>()
    : { data: [] as Student[] };

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const [{ data: families }, { data: guardians }, { data: pickups }, photoUrlMap] =
    familyIds.length
      ? await Promise.all([
          admin
            .from("families")
            .select("id, primary_guardian_name, emergency_contact_name, emergency_contact_relationship")
            .in("id", familyIds)
            .returns<Family[]>(),
          admin
            .from("guardians")
            .select("family_id, full_name, relationship")
            .in("family_id", familyIds)
            .returns<Guardian[]>(),
          admin
            .from("authorized_pickup_persons")
            .select("id, family_id, full_name, relationship, is_restricted, notes")
            .in("family_id", familyIds)
            .order("full_name")
            .returns<Pickup[]>(),
          signedUrlsFor("student-photos", (students ?? []).map((s) => s.photo_path)),
        ])
      : [
          { data: [] as Family[] },
          { data: [] as Guardian[] },
          { data: [] as Pickup[] },
          new Map<string, string | null>(),
        ];

  const familyById = new Map((families ?? []).map((f) => [f.id, f]));
  const guardiansByFamily = new Map<string, Guardian[]>();
  for (const g of guardians ?? []) {
    (guardiansByFamily.get(g.family_id) ?? guardiansByFamily.set(g.family_id, []).get(g.family_id)!).push(g);
  }
  const pickupByFamily = new Map<string, Pickup[]>();
  for (const p of pickups ?? []) {
    (pickupByFamily.get(p.family_id) ?? pickupByFamily.set(p.family_id, []).get(p.family_id)!).push(p);
  }
  const statusByStudent = new Map(group.map((s) => [s.student_id, s]));

  const rows = (students ?? [])
    .map((stu) => ({
      stu,
      status: statusByStudent.get(stu.id)!,
      name: `${stu.preferred_first_name ?? stu.legal_first_name} ${stu.legal_last_name}`.trim(),
      photoUrl: photoUrlMap.get(stu.photo_path ?? "") ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const homeCount = group.filter((s) => s.state === "home").length;

  return (
    <main className="mx-auto max-w-2xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <Link
        href={`/coordinator?date=${day}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-11"
      >
        <ArrowLeftIcon className="size-4" /> Back to dashboard
      </Link>

      <header className="flex items-center gap-3">
        <span
          className="size-6 rounded-full border shrink-0"
          style={{ backgroundColor: groupColor ?? "var(--muted)" }}
          aria-hidden
        />
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{groupName}</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} kid{rows.length === 1 ? "" : "s"} · {homeCount} home · check in / out below
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          No kids on this van today.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ stu, status, name, photoUrl }) => {
            const state = safeDayState(status.state);
            const family = familyById.get(stu.family_id);
            const famGuardians = guardiansByFamily.get(stu.family_id) ?? [];
            const allPickup = pickupByFamily.get(stu.family_id) ?? [];
            const restricted = allPickup.filter((p) => p.is_restricted);
            const allowed = allPickup.filter((p) => !p.is_restricted);
            return (
              <li key={stu.id} className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar url={photoUrl} alt={name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{name}</div>
                    <code className="font-mono text-xs text-muted-foreground">{stu.wristband_code}</code>
                  </div>
                  <StateBadge state={state} size="sm" />
                </div>

                {restricted.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-lg border-2 p-2.5 text-sm"
                    style={{
                      borderColor: "var(--destructive)",
                      backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)",
                    }}
                  >
                    <div className="font-semibold text-destructive">
                      ⛔ DO NOT RELEASE to ({restricted.length}):
                    </div>
                    <ul className="mt-1 space-y-1">
                      {restricted.map((p) => (
                        <li key={p.id}>
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
                  </div>
                )}

                <SafetyCallout allergies={stu.allergies} medicalNotes={stu.medical_notes} />

                <StudentActions
                  studentId={stu.id}
                  eventDate={day}
                  currentState={state}
                  actorRole={user.role}
                  mode={(status.mode as "van" | "parent_dropoff_only" | "parent_pickup_only" | "parent_both" | null) ?? null}
                  pmVanAvailable={status.afternoon_van_id != null}
                  primaryGuardianName={family?.primary_guardian_name ?? null}
                  emergencyContact={
                    family?.emergency_contact_name
                      ? { name: family.emergency_contact_name, relationship: family.emergency_contact_relationship }
                      : null
                  }
                  guardians={famGuardians.map((g) => ({ fullName: g.full_name, relationship: g.relationship }))}
                  authorizedPickup={allowed.map((p) => ({ id: p.id, fullName: p.full_name, relationship: p.relationship }))}
                  stayOnPage
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
