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
      { studentId: "a", name: "Ann", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" },
      { studentId: "b", name: "Bo", lat: null, lng: null, hasAddress: true, currentVanId: null },
      { studentId: "c", name: "Cy", lat: null, lng: null, hasAddress: false, currentVanId: null },
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.map((k) => k.studentId)).toEqual(["a"]);
    expect(data.noAddress.map((k) => k.studentId)).toEqual(["b", "c"]);
  });

  it("colors each pinnable kid by their current van's zone color", () => {
    const kids: KidRow[] = [
      { studentId: "a", name: "Ann", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" },
      { studentId: "b", name: "Bo", lat: 43.6, lng: -96.6, hasAddress: true, currentVanId: "van-blue" },
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.find((k) => k.studentId === "a")?.currentVanColor).toBe("#ef4444");
    expect(data.pinnable.find((k) => k.studentId === "b")?.currentVanColor).toBe("#3b82f6");
  });

  it("colors an unassigned pinnable kid grey", () => {
    const kids: KidRow[] = [
      { studentId: "a", name: "Ann", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: null },
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable[0]?.currentVanColor).toBe(UNASSIGNED_PIN_COLOR);
  });

  it("counts only address-having un-geocoded kids as locatable", () => {
    const kids: KidRow[] = [
      // has address, no coords → locatable
      { studentId: "b", name: "Bo", lat: null, lng: null, hasAddress: true, currentVanId: null },
      // no address at all → NOT locatable, but still surfaced in noAddress
      { studentId: "c", name: "Cy", lat: null, lng: null, hasAddress: false, currentVanId: null },
      // already geocoded → pinnable, not counted
      { studentId: "a", name: "Ann", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: null },
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.locatableCount).toBe(1);
    expect(data.noAddress).toHaveLength(2);
  });

  it("never drops a kid — every input lands in exactly one partition", () => {
    const kids: KidRow[] = [
      { studentId: "a", name: "Ann", lat: 43.5, lng: -96.7, hasAddress: true, currentVanId: "van-red" },
      { studentId: "b", name: "Bo", lat: null, lng: null, hasAddress: true, currentVanId: null },
      { studentId: "c", name: "Cy", lat: null, lng: null, hasAddress: false, currentVanId: null },
    ];
    const data = buildVanAssignMapData(kids, zones);
    expect(data.pinnable.length + data.noAddress.length).toBe(kids.length);
  });

  it("treats a half-coordinate (lat only) as not pinnable", () => {
    const kids: KidRow[] = [
      { studentId: "a", name: "Ann", lat: 43.5, lng: null, hasAddress: true, currentVanId: null },
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
