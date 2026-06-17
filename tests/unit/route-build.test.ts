import { describe, it, expect } from "vitest";
import { nearestStopId, assignStopsForMode } from "@/lib/route-build";

const stops = [
  { id: "a", lat: 43.5, lng: -96.7 },
  { id: "b", lat: 43.6, lng: -96.5 },
];

describe("nearestStopId", () => {
  it("picks the closest stop", () => {
    expect(nearestStopId({ lat: 43.51, lng: -96.69 }, stops)).toBe("a");
    expect(nearestStopId({ lat: 43.59, lng: -96.51 }, stops)).toBe("b");
  });
  it("returns null with no stops", () => {
    expect(nearestStopId({ lat: 43.5, lng: -96.7 }, [])).toBeNull();
  });
});

describe("assignStopsForMode", () => {
  const home = { lat: 43.51, lng: -96.69 }; // nearest = a

  it("fills both legs for a van kid when empty", () => {
    expect(
      assignStopsForMode(home, stops, "van", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: "a", afternoonStopId: "a" });
  });
  it("parent_pickup_only fills only the morning leg", () => {
    expect(
      assignStopsForMode(home, stops, "parent_pickup_only", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: "a", afternoonStopId: null });
  });
  it("parent_dropoff_only fills only the afternoon leg", () => {
    expect(
      assignStopsForMode(home, stops, "parent_dropoff_only", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: null, afternoonStopId: "a" });
  });
  it("never overrides a stop already chosen", () => {
    expect(
      assignStopsForMode(home, stops, "van", { morningStopId: "b", afternoonStopId: null }),
    ).toEqual({ morningStopId: "b", afternoonStopId: "a" });
  });
  it("leaves parent_both untouched", () => {
    expect(
      assignStopsForMode(home, stops, "parent_both", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: null, afternoonStopId: null });
  });
  it("with no stops, returns current unchanged", () => {
    expect(
      assignStopsForMode(home, [], "van", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: null, afternoonStopId: null });
  });
});
