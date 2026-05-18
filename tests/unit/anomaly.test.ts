import { describe, it, expect } from "vitest";
import {
  anomaliesFor,
  ANOMALY_LABEL,
  ANOMALY_SEVERITY,
  type AnomalyKind,
} from "@/lib/anomaly";

describe("anomaliesFor", () => {
  it("returns [] when none are set", () => {
    expect(
      anomaliesFor({
        isLateAm: false,
        isBoardedButNotArrived: false,
        isInButNotOut: false,
        isPmVanStuck: false,
      }),
    ).toEqual([]);
  });

  it("collects all flags in deterministic order", () => {
    expect(
      anomaliesFor({
        isLateAm: true,
        isBoardedButNotArrived: true,
        isInButNotOut: true,
        isPmVanStuck: true,
      }),
    ).toEqual<AnomalyKind[]>([
      "late_am",
      "boarded_but_not_arrived",
      "in_but_not_out",
      "pm_van_stuck",
    ]);
  });

  it("returns a single flag when only one is set", () => {
    expect(
      anomaliesFor({
        isLateAm: false,
        isBoardedButNotArrived: false,
        isInButNotOut: true,
        isPmVanStuck: false,
      }),
    ).toEqual<AnomalyKind[]>(["in_but_not_out"]);
  });
});

describe("anomaly metadata", () => {
  it("has a label for every kind", () => {
    const kinds: AnomalyKind[] = [
      "late_am",
      "boarded_but_not_arrived",
      "in_but_not_out",
      "pm_van_stuck",
    ];
    for (const k of kinds) expect(ANOMALY_LABEL[k]).toBeTruthy();
  });

  it("classifies severity sensibly (boarded-not-arrived and stuck-PM are critical)", () => {
    expect(ANOMALY_SEVERITY.boarded_but_not_arrived).toBe("critical");
    expect(ANOMALY_SEVERITY.in_but_not_out).toBe("critical");
    expect(ANOMALY_SEVERITY.pm_van_stuck).toBe("critical");
    expect(ANOMALY_SEVERITY.late_am).toBe("warning");
  });
});
