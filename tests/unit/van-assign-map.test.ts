import { describe, it, expect } from "vitest";
import {
  buildVanAssignMapData,
  vanColor,
  UNASSIGNED_PIN_COLOR,
  type KidRow,
  type VanZone,
} from "@/lib/van-assign-map";

const zones: VanZone[] = [
  { vanId: "van-red", colorCode: "#ef4444" },
  { vanId: "van-blue", colorCode: "#3b82f6" },
  { vanId: "van-nozone", colorCode: null },
];

/** KidRow with sensible defaults so a test only states what it cares about. */
function kid(over: Partial<KidRow> & Pick<KidRow, "studentId">): KidRow {
  return {
    name: over.studentId,
    lat: null,
    lng: null,
    hasAddress: false,
    geocodeFailed: false,
    street: null,
    city: null,
    currentVanId: null,
    ...over,
  };
}

describe("vanColor", () => {
  it("returns the van's zone color", () => {
    expect(vanColor("van-red", zones)).toBe("#ef4444");
    expect(vanColor("van-blue", zones)).toBe("#3b82f6");
  });
  it("returns grey for an unassigned kid (null van)", () => {
    expect(vanColor(null, zones)).toBe(UNASSIGNED_PIN_COLOR);
  });
  it("returns grey for a van with no zone color", () => {
    expect(vanColor("van-nozone", zones)).toBe(UNASSIGNED_PIN_COLOR);
  });
  it("returns grey for an unknown van id", () => {
    expect(vanColor("van-ghost", zones)).toBe(UNASSIGNED_PIN_COLOR);
  });
});

describe("buildVanAssignMapData", () => {
  it("partitions kids with coords into pinnable and the rest into noAddress", () => {
    const kids: KidRow[] = [
      kid({ studentId: "a", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" }),
      kid({ studentId: "b", hasAddress: true }),
      kid({ studentId: "c" }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.map((k) => k.studentId)).toEqual(["a"]);
    expect(data.noAddress.map((k) => k.studentId)).toEqual(["b", "c"]);
  });

  it("colors each pinnable kid by their current van's zone color", () => {
    const kids: KidRow[] = [
      kid({ studentId: "a", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" }),
      kid({ studentId: "b", lat: 43.6, lng: -96.6, hasAddress: true, currentVanId: "van-blue" }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.find((k) => k.studentId === "a")?.currentVanColor).toBe("#ef4444");
    expect(data.pinnable.find((k) => k.studentId === "b")?.currentVanColor).toBe("#3b82f6");
  });

  it("colors an unassigned pinnable kid grey", () => {
    const kids: KidRow[] = [
      kid({ studentId: "a", lat: 43.5, lng: -96.7, hasAddress: true }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable[0]?.currentVanColor).toBe(UNASSIGNED_PIN_COLOR);
  });

  it("counts only address-having un-geocoded kids as locatable", () => {
    const kids: KidRow[] = [
      kid({ studentId: "b", hasAddress: true }), // locatable
      kid({ studentId: "c", hasAddress: false }), // no address — surfaced, not locatable
      kid({ studentId: "a", lat: 43.5, lng: -96.7, hasAddress: true }), // pinned
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.locatableCount).toBe(1);
    expect(data.noAddress).toHaveLength(2);
  });

  it("a failed-geocode kid is flagged (in noAddress) but NOT counted as locatable", () => {
    const kids: KidRow[] = [
      kid({ studentId: "fail", hasAddress: true, geocodeFailed: true }),
      kid({ studentId: "fresh", hasAddress: true, geocodeFailed: false }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    // Both are surfaced (never dropped)...
    expect(data.noAddress.map((k) => k.studentId).sort()).toEqual(["fail", "fresh"]);
    // ...but only the not-yet-tried one is a Locate target.
    expect(data.locatableCount).toBe(1);
    const failed = data.noAddress.find((k) => k.studentId === "fail");
    expect(failed?.geocodeFailed).toBe(true);
    expect(failed?.hasAddress).toBe(true);
  });

  it("never drops a kid — every input lands in exactly one partition", () => {
    const kids: KidRow[] = [
      kid({ studentId: "a", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" }),
      kid({ studentId: "b", hasAddress: true }),
      kid({ studentId: "c", hasAddress: false }),
      kid({ studentId: "d", hasAddress: true, geocodeFailed: true }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.length + data.noAddress.length).toBe(kids.length);
  });

  it("treats a half-coordinate (lat only) as not pinnable", () => {
    const kids: KidRow[] = [
      kid({ studentId: "a", lat: 43.5, lng: null, hasAddress: true }),
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable).toHaveLength(0);
    expect(data.noAddress).toHaveLength(1);
    expect(data.locatableCount).toBe(1);
  });

  it("handles an empty roster", () => {
    const data = buildVanAssignMapData([], zones);
    expect(data).toEqual({ pinnable: [], noAddress: [], locatableCount: 0 });
  });
});
