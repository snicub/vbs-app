import { describe, it, expect } from "vitest";
import {
  anomaliesFor,
  ANOMALY_LABEL,
  ANOMALY_DESCRIPTION,
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
  it("has a short label and a longer description for every kind", () => {
    const kinds: AnomalyKind[] = [
      "late_am",
      "boarded_but_not_arrived",
      "in_but_not_out",
      "pm_van_stuck",
    ];
    for (const k of kinds) {
      expect(ANOMALY_LABEL[k]).toBeTruthy();
      expect(ANOMALY_DESCRIPTION[k]).toBeTruthy();
      // Short label fits in a badge — under ~25 chars.
      expect(ANOMALY_LABEL[k].length).toBeLessThanOrEqual(28);
    }
  });

  it("classifies severity sensibly (boarded-not-arrived and stuck-PM are critical)", () => {
    expect(ANOMALY_SEVERITY.boarded_but_not_arrived).toBe("critical");
    expect(ANOMALY_SEVERITY.in_but_not_out).toBe("critical");
    expect(ANOMALY_SEVERITY.pm_van_stuck).toBe("critical");
    expect(ANOMALY_SEVERITY.late_am).toBe("warning");
  });
});
