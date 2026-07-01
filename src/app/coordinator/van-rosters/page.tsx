import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { contrastText } from "@/lib/nametags/tag-data";
import { orderPickup, splitStopsIntoLoads, parseCrews } from "@/lib/van-rosters/pickup-order";
import { PrintButton } from "./print-button";
import { ReconcileVansButton } from "./reconcile-vans-button";
import { RegionSelect } from "./region-select";
import { ModeSelect } from "./mode-select";
import { Linkify } from "@/components/linkify";
import { VanCheckInQr } from "./van-checkin-qr";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Van Rosters — Coordinator" };

type Van = { id: string; name: string; capacity: number };
type StopRow = { id: string; color_code: string };
type Assignment = { van_id: string; driver_name: string | null; aide_name: string | null };
type Status = {
  student_id: string;
  mode: string | null;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
};
type Student = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  allergies: string | null;
  medical_notes: string | null;
  family_id: string;
};
type Family = {
  id: string;
  primary_guardian_name: string;
  primary_phone: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  lat: number | null;
  lng: number | null;
};

export default async function VanRostersPage({
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
  const day = date ?? defaultVbsDate(getLocalDate());
  const supabase = await createClient();

  const [{ data: vans }, { data: stops }, { data: routes }, { data: assignments }, { data: statuses }] =
    await Promise.all([
      supabase.from("vans").select("id, name, capacity").eq("active", true).order("name").returns<Van[]>(),
      supabase.from("stops").select("id, color_code").returns<StopRow[]>(),
      supabase.from("routes").select("van_id, direction, stop_ids").returns<DirectionRoute[]>(),
      supabase
        .from("van_assignments")
        .select("van_id, driver_name, aide_name")
        .eq("assignment_date", day)
        .returns<Assignment[]>(),
      supabase
        .from("student_day_status")
        .select("student_id, mode, morning_van_id, afternoon_van_id")
        .eq("event_date", day)
        .eq("attending", true)
        .returns<Status[]>(),
    ]);

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, allergies, medical_notes, family_id")
        .in("id", studentIds)
        .returns<Student[]>()
    : { data: [] as Student[] };

  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  // Families are read via the admin client so the driver's contact + address is
  // never blanked by RLS on the coordinator print.
  const { data: families } = familyIds.length
    ? await createAdminClient()
        .from("families")
        .select("id, primary_guardian_name, primary_phone, street_address, city, state, postal_code, notes, emergency_contact_name, emergency_contact_phone, lat, lng")
        .in("id", familyIds)
        .returns<Family[]>()
    : { data: [] as Family[] };

  const studentById = new Map((students ?? []).map((s) => [s.id, s]));
  const familyById = new Map((families ?? []).map((f) => [f.id, f]));
  const colorByVan = new Map(
    (vans ?? []).map((v) => {
      const zoneId = zoneStopIdForVan(v.id, routes ?? []);
      const stop = zoneId ? (stops ?? []).find((s) => s.id === zoneId) : undefined;
      return [v.id, stop?.color_code ?? "#e5e7eb"];
    }),
  );
  const assignByVan = new Map((assignments ?? []).map((a) => [a.van_id, a]));

  type Rider = {
    studentId: string;
    name: string;
    mode: string | null;
    address: string;
    notes: string | null;
    guardian: string;
    guardianPhone: string;
    emergencyName: string | null;
    emergencyPhone: string | null;
    allergies: string | null;
    medical: string | null;
    lat: number | null;
    lng: number | null;
    addressKey: string;
  };
  function riderFor(s: Student, mode: string | null): Rider {
    const f = familyById.get(s.family_id);
    const cityLine = [f?.city, f?.state, f?.postal_code].map((p) => p?.trim()).filter(Boolean).join(", ");
    return {
      studentId: s.id,
      name: `${s.preferred_first_name ?? s.legal_first_name} ${s.legal_last_name}`.trim(),
      mode,
      address: [f?.street_address?.trim(), cityLine].filter(Boolean).join(" · ") || "—",
      notes: f?.notes?.trim() || null,
      guardian: f?.primary_guardian_name ?? "—",
      guardianPhone: f?.primary_phone ?? "",
      emergencyName: f?.emergency_contact_name ?? null,
      emergencyPhone: f?.emergency_contact_phone ?? null,
      allergies: s.allergies,
      medical: s.medical_notes,
      lat: f?.lat ?? null,
      lng: f?.lng ?? null,
      addressKey: f?.street_address?.trim() ?? "",
    };
  }

  // Group attending kids by their van (door-to-door: morning == afternoon van).
  const ridersByVan = new Map<string, Rider[]>();
  const unassigned: Rider[] = [];
  for (const st of statuses ?? []) {
    const stu = studentById.get(st.student_id);
    if (!stu) continue;
    const vanId = st.morning_van_id ?? st.afternoon_van_id;
    const rider = riderFor(stu, st.mode);
    if (vanId) {
      (ridersByVan.get(vanId) ?? ridersByVan.set(vanId, []).get(vanId)!).push(rider);
    } else {
      unassigned.push(rider);
    }
  }
  const sortRiders = (rs: Rider[]) => rs.slice().sort((a, b) => a.name.localeCompare(b.name));
  const vanOptions = (vans ?? []).map((v) => ({ id: v.id, name: v.name }));

  // A kid off every van is either parent-handled (mode parent_both — no van
  // needed, so no warning) or a van-rider with no van assigned yet (needs
  // routing — the real alert). Split them so the alert doesn't cry wolf over
  // families who chose parent drop-off.
  const parentHandled = unassigned.filter((r) => r.mode === "parent_both");
  const needsRoutingRiders = unassigned.filter((r) => r.mode !== "parent_both");

  return (
    <main className="mx-auto max-w-4xl px-3 sm:px-4 py-4 sm:py-6 space-y-5 print:py-0">
      <header className="flex items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Van rosters</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(day)} · driver sheets with each rider&apos;s home address and family contacts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReconcileVansButton date={day} />
          <PrintButton />
        </div>
      </header>

      {(vans ?? []).flatMap((v) => {
        const riders = ridersByVan.get(v.id) ?? [];
        const assign = assignByVan.get(v.id);
        const color = colorByVan.get(v.id) ?? "#e5e7eb";
        const crews = parseCrews(assign?.driver_name ?? null, assign?.aide_name ?? null);
        const { stops, unlocated } = orderPickup(riders);
        const numLoads = Math.max(1, crews.length);
        const loads = splitStopsIntoLoads(stops, numLoads);

        return loads.map((loadStops, li) => {
          const crew = crews[li];
          const tail = li === loads.length - 1 ? unlocated : [];
          const totalKids =
            loadStops.reduce((sum, s) => sum + s.riders.length, 0) + tail.length;
          return (
            <section
              key={`${v.id}:${li}`}
              className="roster-section rounded-lg border break-inside-avoid print:break-before-page"
            >
              <div
                className="flex items-start justify-between gap-3 px-3 py-2 rounded-t-lg"
                style={{ backgroundColor: color, color: contrastText(color), printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
              >
                <div className="min-w-0">
                  <div className="font-bold text-lg">
                    {v.name}
                    {numLoads > 1 ? ` — Van ${li + 1} of ${numLoads}` : ""}
                  </div>
                  <div className="text-sm font-medium">
                    Driver: {crew?.driver || "—"} · Aide: {crew?.aide || "—"} · {totalKids} kid
                    {totalKids === 1 ? "" : "s"}
                  </div>
                </div>
                <VanCheckInQr vanId={v.id} baseUrl={env.NEXT_PUBLIC_BASE_URL} />
              </div>
              {totalKids === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No riders for this van.</p>
              ) : (
                <ol className="divide-y">
                  {loadStops.map((stop, si) => (
                    <li key={si} className="break-inside-avoid">
                      <div className="px-3 pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Stop {si + 1} · {stop.riders[0]!.address}
                      </div>
                      <ul className="divide-y">
                        {stop.riders.map((r, i) => (
                          <RiderRow key={i} r={r} currentVanId={v.id} eventDate={day} vans={vanOptions} />
                        ))}
                      </ul>
                    </li>
                  ))}
                  {tail.length > 0 && (
                    <li className="break-inside-avoid">
                      <div className="px-3 pt-2 text-xs font-bold uppercase tracking-wide text-[var(--anomaly-warn)]">
                        ⚠ No map location — confirm pickup
                      </div>
                      <ul className="divide-y">
                        {tail.map((r, i) => (
                          <RiderRow key={i} r={r} currentVanId={v.id} eventDate={day} vans={vanOptions} />
                        ))}
                      </ul>
                    </li>
                  )}
                </ol>
              )}
            </section>
          );
        });
      })}

      {needsRoutingRiders.length > 0 && (
        <section className="roster-section rounded-lg border-2 border-[var(--anomaly-warn)] break-inside-avoid print:break-before-page">
          <div className="px-3 py-2 font-bold text-[var(--anomaly-warn)]">
            ⚠ Needs a van ({needsRoutingRiders.length}) — rides a van but none assigned
          </div>
          <ul className="divide-y">
            {sortRiders(needsRoutingRiders).map((r, i) => (
              <RiderRow key={i} r={r} currentVanId={null} eventDate={day} vans={vanOptions} />
            ))}
          </ul>
        </section>
      )}

      {parentHandled.length > 0 && (
        <section className="roster-section rounded-lg border break-inside-avoid print:break-before-page">
          <div className="px-3 py-2 font-bold text-muted-foreground">
            Parent drop-off / pickup ({parentHandled.length}) — no van needed
          </div>
          <ul className="divide-y">
            {sortRiders(parentHandled).map((r, i) => (
              <RiderRow key={i} r={r} currentVanId={null} eventDate={day} vans={vanOptions} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function RiderRow({
  r,
  currentVanId,
  eventDate,
  vans,
}: {
  r: {
    studentId: string;
    name: string;
    mode: string | null;
    address: string;
    notes: string | null;
    guardian: string;
    guardianPhone: string;
    emergencyName: string | null;
    emergencyPhone: string | null;
    allergies: string | null;
    medical: string | null;
    lat: number | null;
    lng: number | null;
  };
  currentVanId: string | null;
  eventDate: string;
  vans: { id: string; name: string }[];
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 text-sm break-inside-avoid">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.name}</span>
          <ModeSelect studentId={r.studentId} mode={r.mode} />
          <RegionSelect
            studentId={r.studentId}
            currentVanId={currentVanId}
            eventDate={eventDate}
            vans={vans}
          />
        </div>
        <div>
          <span className="text-muted-foreground">Home: </span>
          {r.address}
          {r.notes && (
            <span className="text-muted-foreground"> — <Linkify text={r.notes} /></span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Guardian: </span>
          {r.guardian}
          {r.guardianPhone && <span> · {r.guardianPhone}</span>}
          {r.emergencyName && (
            <span className="text-muted-foreground">
              {" "}
              · Emergency: {r.emergencyName}
              {r.emergencyPhone ? ` ${r.emergencyPhone}` : ""}
            </span>
          )}
        </div>
        {(r.allergies || r.medical) && (
          <div className="font-medium text-[var(--medical)]">
            ⚕ {[r.allergies, r.medical].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
