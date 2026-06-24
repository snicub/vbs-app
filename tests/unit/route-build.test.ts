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
  it("puts a van kid on ONE van — both legs the same zone (morning_van == afternoon_van)", () => {
    const r = assignStopsForMode(home, stops, "van", {
      morningStopId: null,
      afternoonStopId: null,
    });
    expect(r.morningStopId).toBe(r.afternoonStopId);
    expect(r.morningStopId).toBe("a");
  });
  it("anchors a van kid's empty leg to the already-pinned zone (never splits across two vans)", () => {
    // 'home' is nearest to 'a', but the coordinator pinned the morning leg to
    // 'b' — the afternoon leg must follow 'b', not jump to the nearer 'a'.
    expect(
      assignStopsForMode(home, stops, "van", { morningStopId: "b", afternoonStopId: null }),
    ).toEqual({ morningStopId: "b", afternoonStopId: "b" });
    expect(
      assignStopsForMode(home, stops, "van", { morningStopId: null, afternoonStopId: "b" }),
    ).toEqual({ morningStopId: "b", afternoonStopId: "b" });
  });
  it("leaves a fully-pinned van kid untouched", () => {
    expect(
      assignStopsForMode(home, stops, "van", { morningStopId: "b", afternoonStopId: "b" }),
    ).toEqual({ morningStopId: "b", afternoonStopId: "b" });
  });
  it("only ever picks from the candidate zones it is given (non-routed stops are excluded upstream)", () => {
    // The caller passes ONLY routable van-zone stops; with just 'b' available a
    // van kid lands on 'b' even though some other (non-routed) stop is nearer.
    const onlyB = [{ id: "b", lat: 43.6, lng: -96.5 }];
    expect(
      assignStopsForMode(home, onlyB, "van", { morningStopId: null, afternoonStopId: null }),
    ).toEqual({ morningStopId: "b", afternoonStopId: "b" });
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
