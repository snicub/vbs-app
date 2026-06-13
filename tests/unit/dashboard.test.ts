import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  computeTownBreakdown,
  type DashStatus,
} from "@/lib/coordinator/dashboard";

function row(p: Partial<DashStatus>): DashStatus {
  return {
    state: "not_started",
    hasAnomaly: false,
    attending: true,
    town: "Springfield",
    colorCode: "#ef4444",
    colorName: "Red",
    ...p,
  };
}

describe("dashboard: computeMetrics", () => {
  it("counts only attending students as expected", () => {
    const m = computeMetrics([
      row({}),
      row({ attending: false }),
      row({}),
    ]);
    expect(m.expected).toBe(2);
  });

  it("on-board counts both van legs", () => {
    const m = computeMetrics([
      row({ state: "van_boarded_am" }),
      row({ state: "van_boarded_pm" }),
      row({ state: "site_checked_in" }),
    ]);
    expect(m.onBoard).toBe(2);
  });

  it("at-site is only currently checked-in kids", () => {
    const m = computeMetrics([
      row({ state: "site_checked_in" }),
      row({ state: "site_checked_out" }),
      row({ state: "site_checked_in" }),
    ]);
    expect(m.atSite).toBe(2);
  });

  it("checked-in is cumulative — anyone who reached site check-in", () => {
    const m = computeMetrics([
      row({ state: "site_checked_in" }),
      row({ state: "site_checked_out" }),
      row({ state: "van_boarded_pm" }),
      row({ state: "home" }),
      row({ state: "not_started" }),
      row({ state: "van_boarded_am" }),
    ]);
    expect(m.checkedIn).toBe(4);
  });

  it("home and no-show counts are exact states", () => {
    const m = computeMetrics([
      row({ state: "home" }),
      row({ state: "home" }),
      row({ state: "marked_no_show" }),
    ]);
    expect(m.home).toBe(2);
    expect(m.noShow).toBe(1);
  });

  it("needs-attention counts attending kids with an anomaly", () => {
    const m = computeMetrics([
      row({ hasAnomaly: true }),
      row({ hasAnomaly: true, attending: false }),
      row({ hasAnomaly: false }),
    ]);
    expect(m.needsAttention).toBe(1);
  });
});

describe("dashboard: computeTownBreakdown", () => {
  it("rolls up coming / checked-in / home per town", () => {
    const towns = computeTownBreakdown([
      row({ town: "Springfield", state: "site_checked_in" }),
      row({ town: "Springfield", state: "home" }),
      row({ town: "Maple Falls", state: "not_started" }),
    ]);
    const spr = towns.find((t) => t.town === "Springfield")!;
    expect(spr.expected).toBe(2);
    expect(spr.checkedIn).toBe(2);
    expect(spr.home).toBe(1);
    const maple = towns.find((t) => t.town === "Maple Falls")!;
    expect(maple.expected).toBe(1);
    expect(maple.checkedIn).toBe(0);
  });

  it("groups stop-less kids under Parent drop-off, sorted last", () => {
    const towns = computeTownBreakdown([
      row({ town: null, state: "site_checked_in" }),
      row({ town: "Springfield" }),
    ]);
    expect(towns[towns.length - 1]!.town).toBe("Parent drop-off");
    expect(towns.find((t) => t.town === "Parent drop-off")!.colorCode).toBeNull();
  });

  it("excludes non-attending kids", () => {
    const towns = computeTownBreakdown([
      row({ town: "Springfield", attending: false }),
      row({ town: "Springfield" }),
    ]);
    expect(towns.find((t) => t.town === "Springfield")!.expected).toBe(1);
  });
});
