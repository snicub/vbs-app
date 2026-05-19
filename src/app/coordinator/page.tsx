import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";
import { anomaliesFor, ANOMALY_LABEL, ANOMALY_SEVERITY } from "@/lib/anomaly";
import { signedUrlFor } from "@/lib/storage/signed-url";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CoordinatorRealtime } from "./realtime";

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
  photo_path: string | null;
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
  const today = date ?? new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(
      "student_id, event_date, state, morning_van_id, afternoon_van_id, wristband_color_for_day, wristband_color_name, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck",
    )
    .eq("event_date", today)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies, photo_path")
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const { data: closeout } = await supabase
    .from("daily_closeouts")
    .select("closed_at, notes")
    .eq("event_date", today)
    .maybeSingle<{ closed_at: string; notes: string | null }>();

  // Short-lived signed URLs for each photo, in parallel.
  const photoUrls = new Map<string, string | null>();
  await Promise.all(
    (students ?? []).map(async (s) => {
      photoUrls.set(s.id, await signedUrlFor("student-photos", s.photo_path));
    }),
  );

  const studentMap = new Map(students!.map((s) => [s.id, s]));
  const enriched = (statuses ?? []).map((s) => {
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
      photoUrl: photoUrls.get(s.student_id) ?? null,
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
  const counts = countByState(enriched);

  return (
    <>
      <CoordinatorRealtime />

      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Today — {formatDate(today)}
          </h1>
          <p className="text-muted-foreground text-sm">
            {enriched.length} student{enriched.length === 1 ? "" : "s"} ·{" "}
            {watchList.length === 0 ? (
              <span className="text-green-700 dark:text-green-400 font-medium">
                nothing needs attention
              </span>
            ) : (
              <span className="text-destructive font-medium">
                {watchList.length} need{watchList.length === 1 ? "s" : ""} attention
              </span>
            )}
            {closeout && (
              <>
                {" · "}
                <Badge variant="secondary">closed at {fmtTime(closeout.closed_at)}</Badge>
              </>
            )}
          </p>
        </div>

        {/* Status counts — colored stripe matches the state badge */}
        <section className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          {(Object.keys(STATE_ORDER) as DayState[]).map((state) => (
            <div
              key={state}
              className="rounded-lg border bg-card px-3 py-2 border-l-4"
              style={{ borderLeftColor: STATE_STRIPE[state] }}
            >
              <div className="text-2xl font-semibold leading-none">{counts[state] ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">{STATE_LABEL[state]}</div>
            </div>
          ))}
        </section>

        {watchList.length > 0 && (
          <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:p-4">
            <h2 className="font-semibold text-destructive mb-3 text-sm sm:text-base">
              Needs attention ({watchList.length})
            </h2>
            <ul className="space-y-2">
              {watchList.map((s) => (
                <li
                  key={s.student_id}
                  className="flex flex-wrap items-center gap-2 rounded-md bg-card border px-2.5 py-2"
                >
                  <Avatar url={s.photoUrl} alt={s.name} size={32} />
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
                      <Badge
                        key={a}
                        variant={
                          ANOMALY_SEVERITY[a] === "critical" ? "destructive" : "warning"
                        }
                      >
                        {ANOMALY_LABEL[a]}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Roster */}
        <section className="rounded-lg border bg-card">
          <div className="border-b px-3 sm:px-4 py-2.5 flex items-center justify-between">
            <h2 className="font-semibold text-sm">Roster ({enriched.length})</h2>
            <div className="text-xs text-muted-foreground hidden sm:block">
              Tap a name to check in / out
            </div>
          </div>
          <ul className="divide-y">
            {sorted.map((s) => (
              <li
                key={s.student_id}
                className="hover:bg-muted/40 active:bg-muted border-l-4"
                style={{ borderLeftColor: STATE_STRIPE[s.state as DayState] }}
              >
                <Link
                  href={`/table/${s.wristbandCode}`}
                  className="flex items-center gap-3 px-3 sm:px-4 py-2.5"
                >
                  <Avatar url={s.photoUrl} alt={s.name} />
                  <ColorDot color={s.wristband_color_for_day} />
                  <span className="font-medium truncate flex-1 min-w-0">{s.name}</span>
                  {s.allergies && (
                    <Badge variant="warning" className="shrink-0">
                      <span className="sm:hidden">!</span>
                      <span className="hidden sm:inline">allergies</span>
                    </Badge>
                  )}
                  <StateBadge state={s.state as DayState} />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer actions — stacked on mobile, inline on desktop */}
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Link
            href="/coordinator/announcements"
            className={buttonVariants({ variant: "outline" })}
          >
            Send announcement
          </Link>
          <Link
            href="/coordinator/closeout"
            className={buttonVariants({ variant: closeout ? "outline" : "default" })}
          >
            {closeout ? "Reopen day…" : "End-of-day closeout"}
          </Link>
        </div>
      </div>
    </>
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

const STATE_BADGE_VARIANT: Record<
  DayState,
  "muted" | "info" | "accent" | "success" | "warning" | "successDeep" | "destructive"
> = {
  not_started:      "muted",        // gray
  van_boarded_am:   "info",         // blue — arriving
  arrived_at_site:  "accent",       // teal — at site, awaiting check-in
  site_checked_in:  "success",      // green — at VBS (safe)
  site_checked_out: "warning",      // amber — heading home from site
  van_boarded_pm:   "warning",      // amber — on PM van home
  home:             "successDeep",  // deep green — home (terminal safe)
  marked_no_show:   "destructive",  // red — no-show
};

// Hex stripes per state — left border on roster rows + count cards.
const STATE_STRIPE: Record<DayState, string> = {
  not_started:      "transparent",
  van_boarded_am:   "rgb(14 165 233)",   // sky-500 (arriving)
  arrived_at_site:  "rgb(20 184 166)",   // teal-500 (at site)
  site_checked_in:  "rgb(34 197 94)",    // green-500 (at VBS)
  site_checked_out: "rgb(251 146 60)",   // orange-400 (leaving site)
  van_boarded_pm:   "rgb(245 158 11)",   // amber-500 (en route home)
  home:             "rgb(22 163 74)",    // green-600 (home)
  marked_no_show:   "rgb(239 68 68)",    // red-500 (no-show)
};

function StateBadge({ state }: { state: DayState }) {
  return <Badge variant={STATE_BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>;
}

function ColorDot({ color }: { color: string | null }) {
  if (!color) {
    return (
      <span className="inline-block w-3 h-3 rounded-full border bg-muted shrink-0" />
    );
  }
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

function Avatar({
  url,
  alt,
  size = 36,
}: {
  url: string | null;
  alt: string;
  size?: number;
}) {
  const base = "rounded-full border object-cover shrink-0";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={alt} className={base} style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      className={
        base +
        " bg-muted text-[10px] text-muted-foreground flex items-center justify-center"
      }
      style={{ width: size, height: size }}
    >
      {alt
        .split(/\s+/)
        .map((s) => s[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}

function countByState(rows: { state: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return counts;
}

function severityRank(anomalies: ReturnType<typeof anomaliesFor>): number {
  if (anomalies.length === 0) return 99;
  const hasCritical = anomalies.some((a) => ANOMALY_SEVERITY[a] === "critical");
  return hasCritical ? 0 : 1;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
