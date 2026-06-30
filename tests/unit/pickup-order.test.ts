import { describe, it, expect } from "vitest";
import { orderPickup, splitStopsIntoLoads, parseCrews } from "@/lib/van-rosters/pickup-order";

const r = (addressKey: string, lat: number | null, lng: number | null, name = addressKey) => ({
  addressKey,
  lat,
  lng,
  name,
});

describe("orderPickup", () => {
  it("groups kids at the same address into one stop", () => {
    const { stops } = orderPickup([
      r("12447 4th st", 45.58, -97.06, "A"),
      r("12447 4th st", 45.58, -97.06, "B"),
      r("12440 barker", 45.59, -97.07, "C"),
    ]);
    const sizes = stops.map((s) => s.riders.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("routes nearest-neighbour from the hub", () => {
    // hub ~ Sisseton (45.663, -97.0481). near < far.
    const near = r("near", 45.66, -97.05, "near");
    const far = r("far", 45.5, -96.9, "far");
    const { stops } = orderPickup([far, near]);
    expect(stops[0]!.riders[0]!.name).toBe("near");
    expect(stops[1]!.riders[0]!.name).toBe("far");
  });

  it("falls back to address order when coordinates are identical (flattened region)", () => {
    const { stops } = orderPickup([
      r("12447 4th st", 45.581, -97.061, "C"),
      r("12440 4th st", 45.581, -97.061, "A"),
      r("12442 4th st", 45.581, -97.061, "B"),
    ]);
    expect(stops.map((s) => s.riders[0]!.addressKey)).toEqual([
      "12440 4th st",
      "12442 4th st",
      "12447 4th st",
    ]);
  });

  it("separates riders with no coordinates as unlocated", () => {
    const { stops, unlocated } = orderPickup([
      r("has coords", 45.6, -97.0, "X"),
      r("no coords", null, null, "Y"),
    ]);
    expect(stops).toHaveLength(1);
    expect(unlocated).toHaveLength(1);
    expect(unlocated[0]!.name).toBe("Y");
  });
});

describe("splitStopsIntoLoads", () => {
  const stop = (n: number) => ({ riders: Array.from({ length: n }, (_, i) => i), lat: 0, lng: 0 });

  it("returns one load for n<=1", () => {
    const stops = [stop(2), stop(3)];
    expect(splitStopsIntoLoads(stops, 1)).toEqual([stops]);
  });

  it("splits 9 riders across 3 loads roughly evenly, keeping households whole", () => {
    const stops = [stop(3), stop(3), stop(3)];
    const loads = splitStopsIntoLoads(stops, 3);
    expect(loads).toHaveLength(3);
    expect(loads.map((l) => l.reduce((s, st) => s + st.riders.length, 0))).toEqual([3, 3, 3]);
  });

  it("always returns exactly n loads even with fewer stops", () => {
    const loads = splitStopsIntoLoads([stop(1)], 3);
    expect(loads).toHaveLength(3);
    expect(loads.filter((l) => l.length > 0)).toHaveLength(1);
  });
});

describe("parseCrews", () => {
  it("pairs comma-separated drivers and aides positionally", () => {
    expect(parseCrews("John, Mike, Sam", "Jane, Sue, Amy")).toEqual([
      { driver: "John", aide: "Jane" },
      { driver: "Mike", aide: "Sue" },
      { driver: "Sam", aide: "Amy" },
    ]);
  });

  it("handles a lone driver or aide", () => {
    expect(parseCrews("John", "")).toEqual([{ driver: "John", aide: "" }]);
    expect(parseCrews("", "")).toEqual([]);
  });
});
