import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";
import { anomaliesFor, ANOMALY_LABEL, ANOMALY_SEVERITY } from "@/lib/anomaly";
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
      "student_id, event_date, state, morning_van_id, afternoon_van_id, wristband_color_name, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck",
    )
    .eq("event_date", today)
    .returns<StatusRow[]>();

  const studentIds = (statuses ?? []).map((s) => s.student_id);
  const { data: students } = studentIds.length > 0
    ? await supabase
        .from("students")
        .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code, allergies")
        .in("id", studentIds)
        .returns<StudentRow[]>()
    : { data: [] as StudentRow[] };

  const { data: closeout } = await supabase
    .from("daily_closeouts")
    .select("closed_at, notes")
    .eq("event_date", today)
    .maybeSingle<{ closed_at: string; notes: string | null }>();

  const studentMap = new Map(students!.map((s) => [s.id, s]));
  const enriched = (statuses ?? []).map((s) => {
    const stu = studentMap.get(s.student_id);
    const flagsToCheck = {
      isLateAm: s.is_late_am,
      isBoardedButNotArrived: s.is_boarded_but_not_arrived,
      isInButNotOut: s.is_in_but_not_out,
      isPmVanStuck: s.is_pm_van_stuck,
    };
    return {
      ...s,
      anomalies: anomaliesFor(flagsToCheck),
      name: stu ? `${stu.preferred_first_name ?? stu.legal_first_name} ${stu.legal_last_name}` : "(unknown)",
      wristbandCode: stu?.wristband_code ?? "",
      allergies: stu?.allergies ?? null,
    };
  });

  const allAnomalies = enriched.filter((s) => s.anomalies.length > 0);
  const sortedByState = enriched.slice().sort((a, b) => {
    const order = STATE_ORDER[a.state as DayState] ?? 99;
    const orderB = STATE_ORDER[b.state as DayState] ?? 99;
    return order - orderB || a.name.localeCompare(b.name);
  });

  const counts = countByState(enriched);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <CoordinatorRealtime />

      <header className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Today — {today}</h1>
          <p className="text-muted-foreground text-sm">
            {enriched.length} student{enriched.length === 1 ? "" : "s"} ·{" "}
            {allAnomalies.length} anomal{allAnomalies.length === 1 ? "y" : "ies"}
            {closeout ? ` · CLOSED at ${new Date(closeout.closed_at).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/coordinator/closeout" className={buttonVariants({ variant: closeout ? "outline" : "default" })}>
            {closeout ? "Reopen…" : "End-of-day closeout"}
          </Link>
          <Link href="/coordinator/announcements" className={buttonVariants({ variant: "outline" })}>
            Announcement
          </Link>
        </div>
      </header>

      {allAnomalies.length > 0 && (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="font-semibold text-destructive">
            {allAnomalies.length} anomaly call-out{allAnomalies.length === 1 ? "" : "s"}
          </h2>
          <ul className="mt-3 space-y-2">
            {allAnomalies.map((s) => (
              <li key={s.student_id} className="text-sm">
                <Link
                  href={`/table/${s.wristbandCode}`}
                  className="font-medium hover:underline"
                >
                  {s.name}
                </Link>{" "}
                ·{" "}
                {s.anomalies.map((a) => (
                  <span
                    key={a}
                    className={
                      "inline-block rounded px-1.5 py-0.5 mr-1 text-xs " +
                      (ANOMALY_SEVERITY[a] === "critical"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300")
                    }
                  >
                    {ANOMALY_LABEL[a]}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-3">By status</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-sm">
          {Object.entries(counts).map(([state, n]) => (
            <div key={state} className="flex justify-between rounded bg-muted/40 px-3 py-1.5">
              <span>{STATE_LABEL[state as DayState] ?? state}</span>
              <strong>{n}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-medium text-muted-foreground">
          Roster
        </div>
        <ul className="divide-y">
          {sortedByState.map((s) => (
            <li key={s.student_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                {s.anomalies.length > 0 && (
                  <span aria-label="anomaly" className="h-2 w-2 rounded-full bg-destructive" />
                )}
                <Link href={`/table/${s.wristbandCode}`} className="font-medium hover:underline">
                  {s.name}
                </Link>
                <code className="font-mono text-xs text-muted-foreground">
                  {s.wristbandCode}
                </code>
                {s.allergies && (
                  <span className="text-xs rounded bg-yellow-500/15 px-1.5 py-0.5 text-yellow-700 dark:text-yellow-300">
                    allergies
                  </span>
                )}
              </div>
              <div className="text-muted-foreground">
                {STATE_LABEL[s.state as DayState] ?? s.state}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
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

function countByState(rows: { state: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return counts;
}

