/**
 * Anomaly-watch cron aggregation — exercises the REAL anomalyPairs +
 * unnotifiedPairs the route uses, so the test can't drift from what the cron
 * actually texts. (The route handler's I/O is integration territory.)
 */
import { describe, it, expect } from "vitest";
import {
  anomalyPairs,
  unnotifiedPairs,
  type AnomalyPair,
  type AnomalyStatusRow,
} from "@/lib/notifications/anomaly-watch";

const row = (over: Partial<AnomalyStatusRow> & { student_id: string }): AnomalyStatusRow => ({
  is_late_am: false,
  is_boarded_but_not_arrived: false,
  is_in_but_not_out: false,
  is_pm_van_stuck: false,
  ...over,
});

describe("anomalyPairs", () => {
  it("explodes one student with two live anomalies into two pairs", () => {
    const pairs = anomalyPairs([
      row({ student_id: "s1", is_boarded_but_not_arrived: true, is_pm_van_stuck: true }),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.kind).sort()).toEqual(["boarded_but_not_arrived", "pm_van_stuck"]);
  });

  it("returns no pairs when no flags are set", () => {
    expect(anomalyPairs([row({ student_id: "s1" })])).toEqual([]);
  });

  it("ignores the retired time-based flags (late_am / in_but_not_out)", () => {
    expect(
      anomalyPairs([row({ student_id: "s1", is_late_am: true, is_in_but_not_out: true })]),
    ).toEqual([]);
  });

  it("emits only the two van-transit alerts when all four flags are set", () => {
    const pairs = anomalyPairs([
      row({
        student_id: "s1",
        is_late_am: true,
        is_boarded_but_not_arrived: true,
        is_in_but_not_out: true,
        is_pm_van_stuck: true,
      }),
    ]);
    expect(pairs.map((p) => p.kind).sort()).toEqual(["boarded_but_not_arrived", "pm_van_stuck"]);
  });

  it("keeps pairs from multiple students", () => {
    const pairs = anomalyPairs([
      row({ student_id: "s1", is_boarded_but_not_arrived: true }),
      row({ student_id: "s2", is_pm_van_stuck: true }),
    ]);
    expect(pairs).toEqual([
      { studentId: "s1", kind: "boarded_but_not_arrived" },
      { studentId: "s2", kind: "pm_van_stuck" },
    ]);
  });
});

describe("unnotifiedPairs", () => {
  const pairs: AnomalyPair[] = [
    { studentId: "s1", kind: "late_am" },
    { studentId: "s1", kind: "in_but_not_out" },
    { studentId: "s2", kind: "late_am" },
  ];

  it("filters out already-notified (student, kind) pairs", () => {
    expect(unnotifiedPairs(pairs, [{ student_id: "s1", anomaly_kind: "late_am" }])).toEqual([
      { studentId: "s1", kind: "in_but_not_out" },
      { studentId: "s2", kind: "late_am" },
    ]);
  });

  it("returns empty when every pair is already notified", () => {
    expect(
      unnotifiedPairs([{ studentId: "s1", kind: "late_am" }], [
        { student_id: "s1", anomaly_kind: "late_am" },
      ]),
    ).toEqual([]);
  });

  it("dedup is per kind — a different notified kind for the same kid doesn't filter", () => {
    const out = unnotifiedPairs([{ studentId: "s1", kind: "late_am" }], [
      { student_id: "s1", anomaly_kind: "pm_van_stuck" },
    ]);
    expect(out).toEqual([{ studentId: "s1", kind: "late_am" }]);
  });

  it("empty notified ledger passes everything through", () => {
    expect(unnotifiedPairs(pairs, [])).toEqual(pairs);
  });
});
