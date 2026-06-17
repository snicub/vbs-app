import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { STATE_PRESENTATION, TONE_CLASSES, safeDayState } from "@/lib/state-presentation";
import { StateBadge } from "@/components/state-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { getLocalDate, formatLocalTime } from "@/lib/date";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { estimatedEtaSeconds, formatEta } from "@/lib/geo";
import { ClockIcon, PhoneIcon, RefreshCwIcon } from "lucide-react";

export const dynamic = "force-dynamic";
// Token URL exposes a family's children + wristband codes — never let it be
// indexed if the link is shared somewhere crawlable.
export const metadata = {
  title: "Family Status — VBS",
  robots: { index: false, follow: false },
};

type FamilyRow = { id: string; primary_guardian_name: string };

type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
};

type StatusRow = {
  student_id: string;
  event_date: string;
  state: string;
  mode: string | null;
  wristband_color_name: string | null;
  wristband_color_for_day: string | null;
  last_event_at: string | null;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  scheduled_am_time: string | null;
  scheduled_pm_time: string | null;
};

type VanRow = { id: string; name: string };
type StopRow = { id: string; name: string; lat: number | null; lng: number | null };
type VanLocationRow = {
  van_id: string;
  lat: number;
  lng: number;
  reported_at: string;
};

const TRANSIT_STATES = new Set<string>([
  "van_boarded_am",
  "arrived_at_site",
  "van_boarded_pm",
]);

function to12h(time24: string): string {
  const [h, m] = time24.split(":");
  const hour = parseInt(h!, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${suffix}`;
}

export default async function ParentStatusPage({
  params,
}: {
  params: Promise<{ familyToken: string }>;
}) {
  const { familyToken } = await params;

  const admin = createAdminClient();

  const { data: token } = await admin
    .from("family_access_tokens")
    .select("family_id, revoked_at, expires_at")
    .eq("token", familyToken)
    .maybeSingle<{ family_id: string; revoked_at: string | null; expires_at: string | null }>();

  if (!token || token.revoked_at || (token.expires_at && new Date(token.expires_at) < new Date())) {
    notFound();
  }

  const today = getLocalDate();

  const [familyRes, studentsRes] = await Promise.all([
    admin
      .from("families")
      .select("id, primary_guardian_name")
      .eq("id", token.family_id)
      .maybeSingle<FamilyRow>(),
    admin
      .from("students")
      .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
      .eq("family_id", token.family_id)
      .returns<StudentRow[]>(),
  ]);

  const family = familyRes.data;
  const students = studentsRes.data;
  if (!family) notFound();

  const studentIds = (students ?? []).map((s) => s.id);
  const { data: statuses } = studentIds.length > 0
    ? await admin
        .from("student_day_status")
        .select("student_id, event_date, state, mode, wristband_color_name, wristband_color_for_day, last_event_at, morning_van_id, afternoon_van_id, morning_stop_id, afternoon_stop_id, scheduled_am_time, scheduled_pm_time")
        .eq("event_date", today)
        .in("student_id", studentIds)
        .returns<StatusRow[]>()
    : { data: [] as StatusRow[] };

  const statusMap = new Map((statuses ?? []).map((s) => [s.student_id, s]));

  // Collect van and stop IDs for name lookups
  const vanIds = new Set<string>();
  const stopIds = new Set<string>();
  for (const s of statuses ?? []) {
    if (s.morning_van_id) vanIds.add(s.morning_van_id);
    if (s.afternoon_van_id) vanIds.add(s.afternoon_van_id);
    if (s.morning_stop_id) stopIds.add(s.morning_stop_id);
    if (s.afternoon_stop_id) stopIds.add(s.afternoon_stop_id);
  }

  const [vansRes, stopsRes, vanLocsRes] = await Promise.all([
    vanIds.size > 0
      ? admin.from("vans").select("id, name").in("id", Array.from(vanIds)).returns<VanRow[]>()
      : { data: [] as VanRow[] },
    stopIds.size > 0
      ? admin
          .from("stops")
          .select("id, name, lat, lng")
          .in("id", Array.from(stopIds))
          .returns<StopRow[]>()
      : { data: [] as StopRow[] },
    vanIds.size > 0
      ? admin
          .from("van_locations")
          .select("van_id, lat, lng, reported_at")
          .in("van_id", Array.from(vanIds))
          .returns<VanLocationRow[]>()
      : { data: [] as VanLocationRow[] },
  ]);

  const vanNames = new Map((vansRes.data ?? []).map((v) => [v.id, v.name]));
  const stopNames = new Map((stopsRes.data ?? []).map((s) => [s.id, s.name]));
  const stopCoords = new Map(
    (stopsRes.data ?? []).map((s) => [s.id, { lat: s.lat, lng: s.lng }]),
  );
  const vanLocs = new Map((vanLocsRes.data ?? []).map((v) => [v.van_id, v]));

  const coordinatorName = env.COORDINATOR_NAME;
  const coordinatorPhone = env.COORDINATOR_PHONE;

  return (
    <main className="mx-auto max-w-xl px-4 py-6 space-y-5">
      <AutoRefresh />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Family Status</h1>
        <p className="text-muted-foreground text-sm">
          Hi {family.primary_guardian_name} — here&apos;s where things stand right now.
        </p>
      </header>

      <ul className="space-y-3">
        {(students ?? []).map((s) => {
          const status = statusMap.get(s.id);
          const state = safeDayState(status?.state ?? "not_started");
          const p = STATE_PRESENTATION[state];
          const tone = TONE_CLASSES[p.tone];
          const Icon = p.icon;

          const isAmTransit = state === "van_boarded_am" || state === "arrived_at_site";
          const isPmTransit = state === "van_boarded_pm";
          const activeVanId = isAmTransit
            ? status?.morning_van_id ?? null
            : isPmTransit
              ? status?.afternoon_van_id ?? null
              : null;
          const vanName = activeVanId ? vanNames.get(activeVanId) ?? null : null;

          const morningStop = status?.morning_stop_id ? stopNames.get(status.morning_stop_id) : null;
          const afternoonStop = status?.afternoon_stop_id ? stopNames.get(status.afternoon_stop_id) : null;
          const amTime = status?.scheduled_am_time ? to12h(status.scheduled_am_time) : null;
          const pmTime = status?.scheduled_pm_time ? to12h(status.scheduled_pm_time) : null;

          // ETA — only meaningful for PM transit (van heading to drop-off
          // stop where parent meets). For AM transit the van is heading AWAY
          // from the morning stop toward the church, so an ETA "to morning
          // stop" would be backwards. Stale GPS (>5 min) also suppresses
          // the bold number entirely to avoid misleading parents.
          let etaSeconds: number | null = null;
          let etaTargetName: string | null = null;
          let etaStaleness: number | null = null;
          if (activeVanId && isPmTransit) {
            const loc = vanLocs.get(activeVanId);
            const targetStopId = status?.afternoon_stop_id;
            const stopCoord = targetStopId ? stopCoords.get(targetStopId) : null;
            if (loc && stopCoord) {
              const staleness = Math.round(
                (Date.now() - new Date(loc.reported_at).getTime()) / 1000,
              );
              etaStaleness = staleness;
              if (staleness <= 300) {
                etaSeconds = estimatedEtaSeconds(
                  loc.lat,
                  loc.lng,
                  stopCoord.lat,
                  stopCoord.lng,
                );
                etaTargetName = targetStopId ? stopNames.get(targetStopId) ?? null : null;
              }
            }
          }
          const etaLabel = formatEta(etaSeconds);

          return (
            <li
              key={s.id}
              className="rounded-xl border bg-card overflow-hidden"
              style={{
                borderLeftWidth: 4,
                borderLeftColor:
                  state === "not_started"
                    ? "var(--border)"
                    : `var(--state-${p.tone})`,
              }}
            >
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-base">
                    {s.preferred_first_name ?? s.legal_first_name} {s.legal_last_name}
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">
                    {s.wristband_code}
                  </code>
                </div>
                <div className="flex items-center gap-3">
                  <Icon className={cn("size-8", tone.icon)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold leading-tight">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </div>
                  <StateBadge state={state} size="sm" className="hidden sm:inline-flex" />
                </div>

                {TRANSIT_STATES.has(state) && vanName && (
                  <div className="text-xs font-medium bg-muted/50 rounded-md px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
                    <span>Van: {vanName}</span>
                    {etaLabel && etaTargetName && (
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <ClockIcon className="size-3.5" aria-hidden />
                        ~{etaLabel} from {etaTargetName}
                        {etaStaleness != null && etaStaleness > 90 && (
                          <span className="text-muted-foreground">
                            (GPS {Math.round(etaStaleness / 60)}m old)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )}

                {(morningStop || afternoonStop) && (
                  <div className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pt-1 border-t">
                    {morningStop && (
                      <div>
                        <span className="font-medium text-foreground">Pickup:</span>{" "}
                        {morningStop}{amTime ? ` at ${amTime}` : ""}
                      </div>
                    )}
                    {afternoonStop && (
                      <div>
                        <span className="font-medium text-foreground">Dropoff:</span>{" "}
                        {afternoonStop}{pmTime ? ` at ${pmTime}` : ""}
                      </div>
                    )}
                  </div>
                )}

                {(status?.last_event_at || status?.wristband_color_name) && (
                  <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap pt-1 border-t">
                    {status?.last_event_at && (
                      <span>
                        Updated{" "}
                        {formatLocalTime(status.last_event_at)}
                      </span>
                    )}
                    {status?.wristband_color_name && (
                      <span className="inline-flex items-center gap-1.5">
                        Wristband:
                        {status.wristband_color_for_day && (
                          <span
                            className="inline-block w-3.5 h-3.5 rounded-full border-2 border-card ring-1 ring-border shadow-sm"
                            style={{ backgroundColor: status.wristband_color_for_day }}
                            aria-hidden
                          />
                        )}
                        <strong className="text-foreground">{status.wristband_color_name}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <RefreshCwIcon className="size-3" />
          Live status — refreshes every 30 seconds.
        </p>
        {coordinatorPhone ? (
          <a
            href={`tel:${coordinatorPhone}`}
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <PhoneIcon className="size-4" />
            {coordinatorName
              ? `Something wrong? Call ${coordinatorName}`
              : "Something wrong? Call the coordinator"}
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            If something looks wrong, contact the coordinator immediately.
          </p>
        )}
      </div>
    </main>
  );
}
