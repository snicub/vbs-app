import type { StudentDayStatus } from "@/types/domain";

export type AnomalyKind =
  | "late_am"
  | "boarded_but_not_arrived"
  | "in_but_not_out"
  | "pm_van_stuck";

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  late_am: "Late AM (no event by scheduled + 45min)",
  boarded_but_not_arrived: "Boarded AM van, never arrived (30min+)",
  in_but_not_out: "Checked in, never checked out",
  pm_van_stuck: "PM van not offloaded after 2h",
};

export const ANOMALY_SEVERITY: Record<AnomalyKind, "warning" | "critical"> = {
  late_am: "warning",
  boarded_but_not_arrived: "critical",
  in_but_not_out: "critical",
  pm_van_stuck: "critical",
};

export function anomaliesFor(
  status: Pick<
    StudentDayStatus,
    "isLateAm" | "isBoardedButNotArrived" | "isInButNotOut" | "isPmVanStuck"
  >,
): AnomalyKind[] {
  const out: AnomalyKind[] = [];
  if (status.isLateAm) out.push("late_am");
  if (status.isBoardedButNotArrived) out.push("boarded_but_not_arrived");
  if (status.isInButNotOut) out.push("in_but_not_out");
  if (status.isPmVanStuck) out.push("pm_van_stuck");
  return out;
}
