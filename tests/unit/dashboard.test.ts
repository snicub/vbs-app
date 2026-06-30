import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  computeVanBreakdown,
  type DashStatus,
} from "@/lib/coordinator/dashboard";

function row(p: Partial<DashStatus>): DashStatus {
  return {
    state: "not_started",
    hasAnomaly: false,
    attending: true,
    vanId: "v1",
    vanName: "Red Van",
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

describe("dashboard: computeVanBreakdown", () => {
  it("rolls up coming / checked-in / home per van", () => {
    const vans = computeVanBreakdown([
      row({ vanId: "v1", vanName: "Red Van", state: "site_checked_in" }),
      row({ vanId: "v1", vanName: "Red Van", state: "home" }),
      row({ vanId: "v2", vanName: "Blue Van", state: "not_started" }),
    ]);
    const red = vans.find((v) => v.vanName === "Red Van")!;
    expect(red.expected).toBe(2);
    expect(red.checkedIn).toBe(2);
    expect(red.home).toBe(1);
    const blue = vans.find((v) => v.vanName === "Blue Van")!;
    expect(blue.expected).toBe(1);
    expect(blue.checkedIn).toBe(0);
  });

  it("groups van kids by van id even if names collide, carrying van color", () => {
    const vans = computeVanBreakdown([
      row({ vanId: "v2", vanName: "Blue Van", colorCode: "#3b82f6", colorName: "Blue" }),
    ]);
    const blue = vans.find((v) => v.vanName === "Blue Van")!;
    expect(blue.colorCode).toBe("#3b82f6");
    expect(blue.colorName).toBe("Blue");
  });

  it("groups van-less kids under Parent drop-off, sorted last with no color", () => {
    const vans = computeVanBreakdown([
      row({ vanId: null, vanName: null, colorCode: null, colorName: null, state: "site_checked_in" }),
      row({ vanId: "v1", vanName: "Red Van" }),
    ]);
    expect(vans[vans.length - 1]!.vanName).toBe("Parent drop-off");
    const parent = vans.find((v) => v.vanName === "Parent drop-off")!;
    expect(parent.colorCode).toBeNull();
    expect(parent.expected).toBe(1);
  });

  it("carries the van id for linking (null for the parent bucket)", () => {
    const vans = computeVanBreakdown([
      row({ vanId: "v1", vanName: "Red Van" }),
      row({ vanId: null, vanName: null }),
    ]);
    expect(vans.find((v) => v.vanName === "Red Van")!.vanId).toBe("v1");
    expect(vans.find((v) => v.vanName === "Parent drop-off")!.vanId).toBeNull();
  });

  it("sorts van rows by name, parent bucket always last", () => {
    const vans = computeVanBreakdown([
      row({ vanId: null, vanName: null }),
      row({ vanId: "v2", vanName: "Blue Van" }),
      row({ vanId: "v1", vanName: "Red Van" }),
    ]);
    expect(vans.map((v) => v.vanName)).toEqual(["Blue Van", "Red Van", "Parent drop-off"]);
  });

  it("excludes non-attending kids", () => {
    const vans = computeVanBreakdown([
      row({ vanId: "v1", vanName: "Red Van", attending: false }),
      row({ vanId: "v1", vanName: "Red Van" }),
    ]);
    expect(vans.find((v) => v.vanName === "Red Van")!.expected).toBe(1);
  });
});
