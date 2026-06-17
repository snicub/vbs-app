/**
 * Pure aggregation for the anomaly-watch cron: turn anomaly-flag rows into
 * (student, kind) alert pairs and drop the ones already texted. Kept out of the
 * route handler so the explosion + dedup rules are unit-testable and the test
 * can't drift from what the cron actually sends.
 */

import { anomaliesFor, type AnomalyKind } from "@/lib/anomaly";

/** A row of the four anomaly booleans off student_day_status (snake_case as the
 *  view returns them). */
export type AnomalyStatusRow = {
  student_id: string;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
};

export type AnomalyPair = { studentId: string; kind: AnomalyKind };

/** Explode each row into one pair per active anomaly kind (a kid with two open
 *  anomalies yields two pairs; no flags → no pairs). */
export function anomalyPairs(rows: AnomalyStatusRow[]): AnomalyPair[] {
  const out: AnomalyPair[] = [];
  for (const a of rows) {
    const kinds = anomaliesFor({
      isLateAm: a.is_late_am,
      isBoardedButNotArrived: a.is_boarded_but_not_arrived,
      isInButNotOut: a.is_in_but_not_out,
      isPmVanStuck: a.is_pm_van_stuck,
    });
    for (const kind of kinds) out.push({ studentId: a.student_id, kind });
  }
  return out;
}

/** Keep only pairs not already in the anomaly_notifications ledger — dedup is
 *  per (student, kind), so a different kind for the same kid still alerts. */
export function unnotifiedPairs(
  pairs: AnomalyPair[],
  notified: { student_id: string; anomaly_kind: string }[],
): AnomalyPair[] {
  const seen = new Set(notified.map((n) => `${n.student_id}:${n.anomaly_kind}`));
  return pairs.filter((p) => !seen.has(`${p.studentId}:${p.kind}`));
}
