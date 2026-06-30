import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { getSessionUser } from "@/lib/auth/session";
import { canDriveVan } from "@/lib/auth/roles";
import { signedUrlsFor } from "@/lib/storage/signed-url";
import { VanManifest } from "./van-manifest";

export const dynamic = "force-dynamic";

type StatusRow = {
  student_id: string;
  event_date: string;
  state: string;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  wristband_color_name: string | null;
  wristband_color_for_day: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
};

type StudentRow = {
  id: string;
  family_id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
  allergies: string | null;
  medical_notes: string | null;
  photo_path: string | null;
};

export default async function VanPage({
  params,
}: {
  params: Promise<{ vanId: string }>;
}) {
  const { vanId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canDriveVan(user.role)) {
    return <main className="p-6 text-sm">Not permitted.</main>;
  }

  const supabase = await createClient();
  const day = getLocalDate();

  const { data: van } = await supabase
    .from("vans")
    .select("id, name, capacity")
    .eq("id", vanId)
    .maybeSingle<{ id: string; name: string; capacity: number }>();
  if (!van) notFound();

  // Get today's statuses for kids on this van (AM or PM)
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(
      "student_id, event_date, state, morning_van_id, afternoon_van_id, wristband_color_name, wristband_color_for_day, morning_stop_id, afternoon_stop_id",
    )
    .eq("event_date", day)
    .eq("attending", true)
    .or(`morning_van_id.eq.${vanId},afternoon_van_id.eq.${vanId}`)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  let students: StudentRow[] = [];
  if (studentIds.length > 0) {
    const { data: studentRows } = await supabase
      .from("students")
      .select(
        "id, family_id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, photo_path",
      )
      .in("id", studentIds)
      .returns<StudentRow[]>();
    students = studentRows ?? [];
  }

  // Batch-sign photo URLs for the manifest in one request. Driver needs to see
  // the kid's face before tapping "Boarded PM van" — this is the cheapest
  // way to prevent kid-to-van mismatches.
  const photoUrls = await signedUrlsFor(
    "student-photos",
    students.map((s) => s.photo_path),
  );

  // Home addresses — door-to-door: the van drives to each rider's home, so the
  // driver needs the full address (tappable to navigate), the address notes
  // (landmarks/directions), and a kid with no address on file is flagged.
  const familyIds = Array.from(new Set(students.map((s) => s.family_id)));
  type HomeInfo = { address: string | null; notes: string | null; mapsUrl: string | null };
  const familyHome = new Map<string, HomeInfo>();
  if (familyIds.length > 0) {
    const { data: fams } = await supabase
      .from("families")
      .select("id, street_address, city, state, postal_code, notes, lat, lng")
      .in("id", familyIds)
      .returns<{
        id: string;
        street_address: string | null;
        city: string | null;
        state: string | null;
        postal_code: string | null;
        notes: string | null;
        lat: number | null;
        lng: number | null;
      }[]>();
    for (const f of fams ?? []) {
      const address =
        [f.street_address, f.city, f.state, f.postal_code].map((p) => p?.trim()).filter(Boolean).join(", ") || null;
      // Prefer the geocoded point for navigation (exact), else the typed address.
      let mapsUrl: string | null = null;
      if (f.lat != null && f.lng != null) {
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`;
      } else if (address) {
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
      }
      familyHome.set(f.id, { address, notes: f.notes?.trim() || null, mapsUrl });
    }
  }

  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, color_name")
    .returns<{ id: string; name: string; color_name: string }[]>();
  const stopMap = new Map((stops ?? []).map((s) => [s.id, s]));

  // Fetch AM route to get the ordered stop list for sort priority.
  // Fall back to PM route if no AM route exists (shouldn't happen in practice).
  const { data: routes } = await supabase
    .from("routes")
    .select("direction, stop_ids")
    .eq("van_id", vanId)
    .returns<{ direction: string; stop_ids: string[] }[]>();
  const amRoute = routes?.find((r) => r.direction === "am");
  const pmRoute = routes?.find((r) => r.direction === "pm");
  const orderedStopIds = amRoute?.stop_ids ?? pmRoute?.stop_ids ?? [];
  const stopOrderMap = new Map(orderedStopIds.map((id, i) => [id, i]));

  const studentMap = new Map(students.map((s) => [s.id, s]));

  const rosterUnsorted = (statuses ?? []).map((status) => {
    const student = studentMap.get(status.student_id);
    const direction: "am" | "pm" | "both" =
      status.morning_van_id === vanId && status.afternoon_van_id === vanId
        ? "both"
        : status.morning_van_id === vanId
          ? "am"
          : "pm";
    const stopId =
      status.morning_van_id === vanId
        ? (status.morning_stop_id ?? "")
        : (status.afternoon_stop_id ?? "");
    return {
      studentId: status.student_id,
      eventDate: status.event_date,
      state: status.state,
      name: student
        ? `${student.preferred_first_name ?? student.legal_first_name} ${student.legal_last_name}`
        : "(unknown)",
      wristbandCode: student?.wristband_code ?? "",
      colorName: status.wristband_color_name,
      colorHex: status.wristband_color_for_day,
      allergies: student?.allergies ?? null,
      medicalNotes: student?.medical_notes ?? null,
      direction,
      stopName: stopMap.get(stopId)?.name ?? null,
      stopOrder: stopOrderMap.get(stopId) ?? Infinity,
      homeAddress: student ? (familyHome.get(student.family_id)?.address ?? null) : null,
      homeNotes: student ? (familyHome.get(student.family_id)?.notes ?? null) : null,
      homeMapsUrl: student ? (familyHome.get(student.family_id)?.mapsUrl ?? null) : null,
      photoUrl: student?.photo_path ? (photoUrls.get(student.photo_path) ?? null) : null,
    };
  });

  const roster = rosterUnsorted.sort((a, b) => {
    if (a.stopOrder !== b.stopOrder) return a.stopOrder - b.stopOrder;
    return a.name.localeCompare(b.name);
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold">{van.name} — riders</h1>
          <Link
            href="/signup"
            target="_blank"
            className="rounded-lg border-2 border-primary px-3 py-2 text-base font-semibold text-primary hover:bg-primary/10"
          >
            + Register a new student
          </Link>
        </div>
        <p className="text-muted-foreground text-base">
          {roster.length} kid{roster.length === 1 ? "" : "s"}
        </p>
      </header>

      {van.capacity > 0 && roster.length > van.capacity && (
        <div className="rounded-lg border-2 border-[var(--anomaly-warn)] bg-[var(--anomaly-warn)]/10 px-4 py-3">
          <p className="text-base font-semibold text-[var(--anomaly-warn)]">
            ⚠ {roster.length} riders · van holds {van.capacity} — make about{" "}
            {Math.ceil(roster.length / van.capacity)} trips
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Board a full load ({van.capacity}), drive them to the church, then come back for
            the next group. Everyone stays on this list until you board them.
          </p>
        </div>
      )}

      <VanManifest
        vanId={vanId}
        eventDate={day}
        roster={roster}
        loadedAt={new Date().toISOString()}
      />
    </main>
  );
}
