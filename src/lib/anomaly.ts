import type { StudentDayStatus } from "@/types/domain";

export type AnomalyKind =
  | "late_am"
  | "boarded_but_not_arrived"
  | "in_but_not_out"
  | "pm_van_stuck";

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  late_am: "Late AM pickup",
  boarded_but_not_arrived: "On van but never arrived",
  in_but_not_out: "Never checked out",
  pm_van_stuck: "PM van not offloaded",
};

export const ANOMALY_DESCRIPTION: Record<AnomalyKind, string> = {
  late_am: "No AM event 45 minutes after scheduled pickup",
  boarded_but_not_arrived: "Boarded the AM van but no site check-in within 30 minutes",
  in_but_not_out: "Checked in at site but never checked out, past scheduled PM time",
  pm_van_stuck: "PM van boarded but not offloaded after 2 hours",
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
  // late_am and in_but_not_out are retired: they relied on per-van scheduled
  // times, which are no longer collected. The two van-transit alerts below
  // don't depend on scheduled times and stay (a kid on a van must be accounted
  // for). The flags + labels are kept in the type for historical records.
  if (status.isBoardedButNotArrived) out.push("boarded_but_not_arrived");
  if (status.isPmVanStuck) out.push("pm_van_stuck");
  return out;
}
