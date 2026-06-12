/**
 * Anomaly-watch cron logic — pair generation + dedup filtering. The actual
 * route handler is integration-tested; here we cover the inner aggregation.
 */
import { describe, it, expect } from "vitest";
import { anomaliesFor, type AnomalyKind } from "@/lib/anomaly";

type AnomalyRow = {
  student_id: string;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
};

function pairsFrom(rows: AnomalyRow[]): { studentId: string; kind: AnomalyKind }[] {
  const out: { studentId: string; kind: AnomalyKind }[] = [];
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

function filterAlreadyNotified(
  pairs: { studentId: string; kind: AnomalyKind }[],
  notified: { studentId: string; kind: string }[],
): { studentId: string; kind: AnomalyKind }[] {
  const seen = new Set(notified.map((n) => `${n.studentId}:${n.kind}`));
  return pairs.filter((p) => !seen.has(`${p.studentId}:${p.kind}`));
}

describe("anomaly-watch pair generation", () => {
  it("explodes one student with two anomalies into two pairs", () => {
    const pairs = pairsFrom([
      {
        student_id: "s1",
        is_late_am: true,
        is_boarded_but_not_arrived: false,
        is_in_but_not_out: true,
        is_pm_van_stuck: false,
      },
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.kind).sort()).toEqual(["in_but_not_out", "late_am"]);
  });

  it("returns empty pairs when no flags are set", () => {
    const pairs = pairsFrom([
      {
        student_id: "s1",
        is_late_am: false,
        is_boarded_but_not_arrived: false,
        is_in_but_not_out: false,
        is_pm_van_stuck: false,
      },
    ]);
    expect(pairs).toEqual([]);
  });

  it("handles all four flags on one student", () => {
    const pairs = pairsFrom([
      {
        student_id: "s1",
        is_late_am: true,
        is_boarded_but_not_arrived: true,
        is_in_but_not_out: true,
        is_pm_van_stuck: true,
      },
    ]);
    expect(pairs).toHaveLength(4);
  });
});

describe("anomaly-watch dedup", () => {
  it("filters out already-notified pairs", () => {
    const pairs: { studentId: string; kind: AnomalyKind }[] = [
      { studentId: "s1", kind: "late_am" },
      { studentId: "s1", kind: "in_but_not_out" },
      { studentId: "s2", kind: "late_am" },
    ];
    const out = filterAlreadyNotified(pairs, [
      { studentId: "s1", kind: "late_am" },
    ]);
    expect(out).toEqual([
      { studentId: "s1", kind: "in_but_not_out" },
      { studentId: "s2", kind: "late_am" },
    ]);
  });

  it("returns the empty array when every pair is already notified", () => {
    const pairs: { studentId: string; kind: AnomalyKind }[] = [
      { studentId: "s1", kind: "late_am" },
    ];
    expect(
      filterAlreadyNotified(pairs, [{ studentId: "s1", kind: "late_am" }]),
    ).toEqual([]);
  });

  it("does not match across different anomaly kinds", () => {
    const pairs: { studentId: string; kind: AnomalyKind }[] = [
      { studentId: "s1", kind: "late_am" },
    ];
    // notified pm_van_stuck for the same kid — should NOT filter late_am
    const out = filterAlreadyNotified(pairs, [
      { studentId: "s1", kind: "pm_van_stuck" },
    ]);
    expect(out).toEqual(pairs);
  });
});
