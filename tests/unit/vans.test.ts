import { describe, it, expect } from "vitest";
import {
  orderStopIds,
  sameDriverAndAide,
  routeStopConflicts,
  isValidTimeOfDay,
  zoneStopIdForVan,
  findVansMissingZone,
} from "@/lib/vans";

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

  it("does not flag a van's own zone on its am+pm against other vans", () => {
    // A van's zone stop sits on its OWN am and pm routes — only OTHER vans'
    // routes are passed in, so the same stop on both directions never collides.
    expect(routeStopConflicts({ am: ["zone1"], pm: ["zone1"] }, [])).toEqual([]);
  });
});

describe("isValidTimeOfDay", () => {
  it("accepts 24-hour HH:MM", () => {
    expect(isValidTimeOfDay("08:00")).toBe(true);
    expect(isValidTimeOfDay("23:59")).toBe(true);
    expect(isValidTimeOfDay("00:00")).toBe(true);
  });

  it("accepts HH:MM:SS (what Postgres time returns)", () => {
    expect(isValidTimeOfDay("15:30:00")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isValidTimeOfDay("  09:15  ")).toBe(true);
  });

  it("rejects out-of-range or malformed times", () => {
    expect(isValidTimeOfDay("24:00")).toBe(false);
    expect(isValidTimeOfDay("9:15")).toBe(false);
    expect(isValidTimeOfDay("08:60")).toBe(false);
    expect(isValidTimeOfDay("")).toBe(false);
    expect(isValidTimeOfDay("morning")).toBe(false);
  });
});

describe("zoneStopIdForVan", () => {
  const routes = [
    { van_id: "v1", direction: "am" as const, stop_ids: ["zone1"] },
    { van_id: "v1", direction: "pm" as const, stop_ids: ["zone1"] },
    { van_id: "v2", direction: "pm" as const, stop_ids: ["zone2"] },
  ];

  it("resolves the zone stop from the am route", () => {
    expect(zoneStopIdForVan("v1", routes)).toBe("zone1");
  });

  it("falls back to the pm route when there is no am route", () => {
    expect(zoneStopIdForVan("v2", routes)).toBe("zone2");
  });

  it("returns null when the van has no route stop", () => {
    expect(zoneStopIdForVan("v3", routes)).toBeNull();
  });

  it("returns null when the route exists but its stop list is empty", () => {
    expect(
      zoneStopIdForVan("v4", [{ van_id: "v4", direction: "am", stop_ids: [] }]),
    ).toBeNull();
  });
});

describe("findVansMissingZone", () => {
  const routes = [
    { van_id: "v1", direction: "am" as const, stop_ids: ["zone1"] },
    { van_id: "v1", direction: "pm" as const, stop_ids: ["zone1"] },
  ];

  it("returns vans with no zone stop", () => {
    expect(
      findVansMissingZone([{ id: "v1" }, { id: "v2" }, { id: "v3" }], routes),
    ).toEqual([{ id: "v2" }, { id: "v3" }]);
  });

  it("returns nothing when every van has a zone", () => {
    expect(findVansMissingZone([{ id: "v1" }], routes)).toEqual([]);
  });

  it("treats an empty-array route as missing", () => {
    expect(
      findVansMissingZone([{ id: "v5" }], [{ van_id: "v5", direction: "am", stop_ids: [] }]),
    ).toEqual([{ id: "v5" }]);
  });
});
