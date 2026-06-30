import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { defaultVbsDate } from "@/lib/registration/dates";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { type DayState } from "@/lib/events/state-machine";
import { anomaliesFor } from "@/lib/anomaly";
import { ANOMALY_PRESENTATION } from "@/lib/state-presentation";
import { signedUrlsFor } from "@/lib/storage/signed-url";
import {
  AnomalyBadge,
} from "@/components/state-badge";
import { AlertTriangleIcon, MapPinOffIcon } from "lucide-react";
import { RosterList, Avatar } from "./roster-list";
import { DashboardCards } from "./dashboard-cards";
import { computeMetrics, computeVanBreakdown } from "@/lib/coordinator/dashboard";
import { needsRouting } from "@/lib/routing";
import { RouteBuildButton } from "./route-build-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coordinator — Today" };

type StatusRow = {
  student_id: string;
  event_date: string;
  state: string;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  wristband_color_for_day: string | null;
  wristband_color_name: string | null;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
};

type StudentRow = {
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

export default async function CoordinatorTodayPage({
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
  const today = date ?? defaultVbsDate(getLocalDate());

  const supabase = await createClient();

  // Everything keyed only on `today` can fetch in one round-trip layer:
  // the per-kid statuses, the day records (attendance + stops), the stop
  // catalog, and the closeout. None depends on another's result.
  const [
    { data: statuses },
    { data: dayRecords },
    { data: vans },
  ] = await Promise.all([
    supabase
      .from("student_day_status")
      .select(
        "student_id, event_date, state, morning_van_id, afternoon_van_id, wristband_color_for_day, wristband_color_name, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck",
      )
      .eq("event_date", today)
      .returns<StatusRow[]>(),
    supabase
      .from("student_day_records")
      .select("student_id, mode, morning_stop_id, afternoon_stop_id, attending")
      .eq("event_date", today)
      .returns<{ student_id: string; mode: string | null; morning_stop_id: string | null; afternoon_stop_id: string | null; attending: boolean }[]>(),
    supabase
      .from("vans")
      .select("id, name")
      .returns<{ id: string; name: string }[]>(),
  ]);
  const vanNameMap = new Map((vans ?? []).map((v) => [v.id, v.name]));
  const dayRecMap = new Map((dayRecords ?? []).map((d) => [d.student_id, d]));

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, medical_notes, photo_path, family_id")
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  // Family names (for roster search) and signed photo URLs both depend only on
  // the student rows, so fetch them concurrently.
  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const [{ data: families }, photoUrlMap] = await Promise.all([
    familyIds.length > 0
      ? supabase
          .from("families")
          .select("id, primary_guardian_name")
          .in("id", familyIds)
          .returns<{ id: string; primary_guardian_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; primary_guardian_name: string }[] }),
    signedUrlsFor("student-photos", (students ?? []).map((s) => s.photo_path)),
  ]);
  const familyNameMap = new Map((families ?? []).map((f) => [f.id, f.primary_guardian_name]));
  const photoUrls = new Map<string, string | null>(
    (students ?? []).map((s) => [s.id, s.photo_path ? (photoUrlMap.get(s.photo_path) ?? null) : null]),
  );

  const studentMap = new Map((students ?? []).map((s) => [s.id, s]));
  // The dashboard cards count attending kids only; the header count and roster
  // must match, so we drop non-attending kids here. (A missing day-record
  // defaults to attending, same as the dashboard.) Non-attending kids are also
  // already excluded from the dashboard helpers and the needs-routing list, so
  // filtering here keeps all three views in agreement.
  const enriched = (statuses ?? [])
    .filter((s) => dayRecMap.get(s.student_id)?.attending ?? true)
    .map((s) => {
    const stu = studentMap.get(s.student_id);
    return {
      ...s,
      anomalies: anomaliesFor({
        isLateAm: s.is_late_am,
        isBoardedButNotArrived: s.is_boarded_but_not_arrived,
        isInButNotOut: s.is_in_but_not_out,
        isPmVanStuck: s.is_pm_van_stuck,
      }),
      name: stu
        ? `${stu.preferred_first_name ?? stu.legal_first_name} ${stu.legal_last_name}`
        : "(unknown)",
      wristbandCode: stu?.wristband_code ?? "",
      allergies: stu?.allergies ?? null,
      medicalNotes: stu?.medical_notes ?? null,
      photoUrl: photoUrls.get(s.student_id) ?? null,
      familyName: stu?.family_id ? (familyNameMap.get(stu.family_id) ?? "") : "",
    };
  });

  const sorted = enriched.slice().sort((a, b) => {
    const aSev = severityRank(a.anomalies);
    const bSev = severityRank(b.anomalies);
    if (aSev !== bSev) return aSev - bSev;
    const sa = STATE_ORDER[a.state as DayState] ?? 99;
    const sb = STATE_ORDER[b.state as DayState] ?? 99;
    return sa - sb || a.name.localeCompare(b.name);
  });

  const watchList = sorted.filter((s) => s.anomalies.length > 0);

  const dashRows = enriched.map((s) => {
    const dr = dayRecMap.get(s.student_id);
    const vanId = s.morning_van_id ?? s.afternoon_van_id;
    return {
      state: s.state,
      hasAnomaly: s.anomalies.length > 0,
      attending: dr?.attending ?? true,
      vanId,
      vanName: vanId ? vanNameMap.get(vanId) ?? null : null,
      colorCode: s.wristband_color_for_day,
      colorName: s.wristband_color_name,
    };
  });
  const metrics = computeMetrics(dashRows);
  const vanRollup = computeVanBreakdown(dashRows);

  const needsRoutingList = enriched.filter((s) => {
    const dr = dayRecMap.get(s.student_id);
    return needsRouting({
      mode: dr?.mode ?? null,
      morningVanId: s.morning_van_id,
      afternoonVanId: s.afternoon_van_id,
      attending: dr?.attending ?? true,
    });
  });

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Today — {formatDate(today)}
        </h1>
        <p className="text-muted-foreground text-sm">
          {enriched.length} student{enriched.length === 1 ? "" : "s"} ·{" "}
          {watchList.length === 0 ? (
            <span className="text-[var(--state-safe)] font-medium">
              nothing needs attention
            </span>
          ) : (
            <span className="text-[var(--anomaly-critical)] font-medium">
              {watchList.length} need{watchList.length === 1 ? "s" : ""} attention
            </span>
          )}
        </p>
      </header>

      {watchList.length > 0 && (
        <section className="rounded-xl border-2 border-[var(--anomaly-critical)]/30 bg-[var(--anomaly-critical)]/5 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangleIcon
              className="size-5 text-[var(--anomaly-critical)]"
              aria-hidden
            />
            <h2 className="font-semibold text-[var(--anomaly-critical)] text-sm sm:text-base">
              Needs attention ({watchList.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {watchList.map((s) => (
              <li
                key={s.student_id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-card border px-2.5 py-2"
              >
                <Avatar url={s.photoUrl} alt={s.name} size={40} />
                <Link
                  href={`/table/${s.wristbandCode}`}
                  className="font-medium hover:underline text-sm"
                >
                  {s.name}
                </Link>
                <code className="font-mono text-xs text-muted-foreground hidden sm:inline">
                  {s.wristbandCode}
                </code>
                <div className="flex flex-wrap gap-1 ml-auto">
                  {s.anomalies.map((a) => (
                    <AnomalyBadge key={a} kind={a} size="sm" />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {needsRoutingList.length > 0 && (
        <section className="rounded-xl border-2 border-[var(--anomaly-warn)]/30 bg-[var(--anomaly-warn)]/5 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <MapPinOffIcon className="size-5 text-[var(--anomaly-warn)]" aria-hidden />
            <h2 className="font-semibold text-sm sm:text-base">
              Needs routing ({needsRoutingList.length})
            </h2>
            <div className="ml-auto">
              <RouteBuildButton date={today} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            These kids ride a van but aren&apos;t on one yet. Assign a van so they show up on
            its rider list and get the late-arrival alert.
          </p>
          <ul className="space-y-2">
            {needsRoutingList.map((s) => (
              <li
                key={s.student_id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-card border px-2.5 py-2"
              >
                <Link
                  href={`/coordinator/students/${s.student_id}/edit`}
                  className="font-medium hover:underline text-sm"
                >
                  {s.name}
                </Link>
                <code className="font-mono text-xs text-muted-foreground hidden sm:inline">
                  {s.wristbandCode}
                </code>
                <span className="ml-auto text-xs font-medium text-[var(--anomaly-warn)]">
                  Assign van →
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dashboard — big at-a-glance numbers + per-van rollup */}
      <DashboardCards metrics={metrics} vans={vanRollup} date={today} />

      {/* Roster */}
      <RosterList students={sorted} />
    </div>
  );
}

const STATE_ORDER: Record<DayState, number> = {
  not_started: 0,
  van_boarded_am: 1,
  arrived_at_site: 2,
  site_checked_in: 3,
  site_checked_out: 4,
  van_boarded_pm: 5,
  home: 6,
  marked_no_show: 7,
};

function severityRank(anomalies: ReturnType<typeof anomaliesFor>): number {
  if (anomalies.length === 0) return 99;
  const hasCritical = anomalies.some(
    (a) => ANOMALY_PRESENTATION[a].tone === "critical",
  );
  return hasCritical ? 0 : 1;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

