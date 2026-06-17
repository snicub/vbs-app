import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import type { AnomalyKind } from "@/lib/anomaly";
import type { DayState } from "@/lib/events/state-machine";
import { CloseoutForm } from "./closeout-form";

export const dynamic = "force-dynamic";

type StatusRow = {
  student_id: string;
  preferred_first_name: string | null;
  legal_first_name: string;
  legal_last_name: string;
  wristband_code: string;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
  state: DayState;
};

export type AnomalyStudent = {
  studentId: string;
  displayName: string;
  wristbandCode: string;
  anomalies: AnomalyKind[];
};

export type NonTerminalStudent = {
  studentId: string;
  displayName: string;
  wristbandCode: string;
  state: DayState;
};

export default async function CloseoutPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) return <main className="p-6">Not permitted.</main>;

  const supabase = await createClient();
  const today = getLocalDate();

  const { data: closeout } = await supabase
    .from("daily_closeouts")
    .select("closed_at, notes, pending_anomalies")
    .eq("event_date", today)
    .maybeSingle<{ closed_at: string; notes: string | null; pending_anomalies: unknown }>();

  const { data: statuses } = await supabase
    .from("student_day_status")
    .select(`
      student_id,
      is_late_am,
      is_boarded_but_not_arrived,
      is_in_but_not_out,
      is_pm_van_stuck,
      state,
      students!inner (
        preferred_first_name,
        legal_first_name,
        legal_last_name,
        wristband_code
      )
    `)
    .eq("event_date", today)
    // Attending-only, like the rest of the coordinator surface. Otherwise a
    // withdrawn kid sits in not_started (non-terminal) and shows up in the
    // "N students not yet home" warning, forcing a false "close out anyway?".
    .eq("attending", true)
    .returns<(Omit<StatusRow, "preferred_first_name" | "legal_first_name" | "legal_last_name" | "wristband_code"> & {
      students: {
        preferred_first_name: string | null;
        legal_first_name: string;
        legal_last_name: string;
        wristband_code: string;
      };
    })[]>();

  const rows: StatusRow[] = (statuses ?? []).map((s) => ({
    student_id: s.student_id,
    preferred_first_name: s.students.preferred_first_name,
    legal_first_name: s.students.legal_first_name,
    legal_last_name: s.students.legal_last_name,
    wristband_code: s.students.wristband_code,
    is_late_am: s.is_late_am,
    is_boarded_but_not_arrived: s.is_boarded_but_not_arrived,
    is_in_but_not_out: s.is_in_but_not_out,
    is_pm_van_stuck: s.is_pm_van_stuck,
    state: s.state,
  }));

  function displayName(r: StatusRow): string {
    return `${r.preferred_first_name ?? r.legal_first_name} ${r.legal_last_name}`;
  }

  const anomalyStudents: AnomalyStudent[] = rows
    .filter((s) => s.is_late_am || s.is_boarded_but_not_arrived || s.is_in_but_not_out || s.is_pm_van_stuck)
    .map((s) => {
      const anomalies: AnomalyKind[] = [];
      if (s.is_late_am) anomalies.push("late_am");
      if (s.is_boarded_but_not_arrived) anomalies.push("boarded_but_not_arrived");
      if (s.is_in_but_not_out) anomalies.push("in_but_not_out");
      if (s.is_pm_van_stuck) anomalies.push("pm_van_stuck");
      return { studentId: s.student_id, displayName: displayName(s), wristbandCode: s.wristband_code, anomalies };
    });

  const nonTerminalStudents: NonTerminalStudent[] = rows
    .filter((s) => s.state !== "home" && s.state !== "marked_no_show")
    .map((s) => ({
      studentId: s.student_id,
      displayName: displayName(s),
      wristbandCode: s.wristband_code,
      state: s.state,
    }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-2xl font-semibold">End-of-day closeout</h1>
      <p className="text-muted-foreground text-sm">
        Acknowledge any open anomalies and record the day as closed.
      </p>
      <CloseoutForm
        eventDate={today}
        anomalyStudents={anomalyStudents}
        nonTerminalStudents={nonTerminalStudents}
        existing={closeout}
      />
    </main>
  );
}
