import { describe, it, expect } from "vitest";
import {
  orderStopIds,
  sameDriverAndAide,
  routeStopConflicts,
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
  it("is true when both names are set and equal", () => {
    expect(sameDriverAndAide("John", "John")).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(sameDriverAndAide("John", " john ")).toBe(true);
    expect(sameDriverAndAide("  Mary Smith ", "mary smith")).toBe(true);
  });

  it("is false when the names differ", () => {
    expect(sameDriverAndAide("John", "Jane")).toBe(false);
  });

  it("is false when either name is null", () => {
    expect(sameDriverAndAide(null, "John")).toBe(false);
    expect(sameDriverAndAide("John", null)).toBe(false);
    expect(sameDriverAndAide(null, null)).toBe(false);
  });

  it("is false when either name is blank or whitespace-only", () => {
    expect(sameDriverAndAide("", "")).toBe(false);
    expect(sameDriverAndAide("   ", "   ")).toBe(false);
    expect(sameDriverAndAide("John", "")).toBe(false);
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
