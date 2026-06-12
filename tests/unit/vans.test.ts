import { describe, it, expect } from "vitest";
import { orderStopIds, sameDriverAndAide, routeStopConflicts } from "@/lib/vans";

describe("orderStopIds", () => {
  const stops = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("returns selected ids in the stops' display order, not selection order", () => {
    expect(orderStopIds(["c", "a"], stops)).toEqual(["a", "c"]);
  });

  it("accepts a Set", () => {
    expect(orderStopIds(new Set(["d", "b"]), stops)).toEqual(["b", "d"]);
  });

  it("ignores ids not present in the stop list", () => {
    expect(orderStopIds(["x", "b"], stops)).toEqual(["b"]);
  });

  it("returns an empty array for no selection", () => {
    expect(orderStopIds([], stops)).toEqual([]);
  });
});

describe("sameDriverAndAide", () => {
  it("is true only when both are set and equal", () => {
    expect(sameDriverAndAide("u1", "u1")).toBe(true);
  });

  it("is false when they differ", () => {
    expect(sameDriverAndAide("u1", "u2")).toBe(false);
  });

  it("is false when either is null", () => {
    expect(sameDriverAndAide(null, "u1")).toBe(false);
    expect(sameDriverAndAide("u1", null)).toBe(false);
    expect(sameDriverAndAide(null, null)).toBe(false);
  });
});

describe("routeStopConflicts", () => {
  it("flags a stop already on another van's route in the same direction", () => {
    expect(
      routeStopConflicts({ am: ["s1", "s2"], pm: [] }, [
        { van_id: "vanB", direction: "am", stop_ids: ["s2"] },
      ]),
    ).toEqual([{ stopId: "s2", vanId: "vanB", direction: "am" }]);
  });

  it("ignores the same stop in the opposite direction", () => {
    expect(
      routeStopConflicts({ am: ["s1"], pm: [] }, [
        { van_id: "vanB", direction: "pm", stop_ids: ["s1"] },
      ]),
    ).toEqual([]);
  });

  it("returns nothing when there is no overlap", () => {
    expect(
      routeStopConflicts({ am: ["s1"], pm: ["s3"] }, [
        { van_id: "vanB", direction: "am", stop_ids: ["s2"] },
        { van_id: "vanB", direction: "pm", stop_ids: ["s4"] },
      ]),
    ).toEqual([]);
  });

  it("detects afternoon conflicts too", () => {
    expect(
      routeStopConflicts({ am: [], pm: ["s5"] }, [
        { van_id: "vanC", direction: "pm", stop_ids: ["s5", "s6"] },
      ]),
    ).toEqual([{ stopId: "s5", vanId: "vanC", direction: "pm" }]);
  });
});
