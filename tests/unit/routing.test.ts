import { describe, it, expect } from "vitest";
import {
  needsRouting,
  ridesMorningVan,
  ridesAfternoonVan,
  boardedStopConflict,
  planRegionMove,
} from "@/lib/routing";

const row = (over: Partial<Parameters<typeof needsRouting>[0]>) => ({
  mode: "van",
  morningVanId: "v1",
  afternoonVanId: "v1",
  attending: true,
  ...over,
});

describe("ridesMorningVan / ridesAfternoonVan", () => {
  it("maps modes to the legs that use a van", () => {
    expect(ridesMorningVan("van")).toBe(true);
    expect(ridesMorningVan("parent_pickup_only")).toBe(true);
    expect(ridesMorningVan("parent_dropoff_only")).toBe(false);
    expect(ridesMorningVan("parent_both")).toBe(false);

    expect(ridesAfternoonVan("van")).toBe(true);
    expect(ridesAfternoonVan("parent_dropoff_only")).toBe(true);
    expect(ridesAfternoonVan("parent_pickup_only")).toBe(false);
    expect(ridesAfternoonVan("parent_both")).toBe(false);
  });
});

describe("needsRouting", () => {
  it("flags a van kid missing either van (no stop, or stop not on a route)", () => {
    expect(needsRouting(row({ morningVanId: null }))).toBe(true);
    expect(needsRouting(row({ afternoonVanId: null }))).toBe(true);
    expect(needsRouting(row({ morningVanId: null, afternoonVanId: null }))).toBe(true);
  });

  it("clears a van kid once both legs resolve to a van", () => {
    expect(needsRouting(row({ morningVanId: "v1", afternoonVanId: "v2" }))).toBe(false);
  });

  it("is directional for one-way riders", () => {
    // pickup-only needs only the morning van
    expect(needsRouting(row({ mode: "parent_pickup_only", morningVanId: null, afternoonVanId: null }))).toBe(true);
    expect(needsRouting(row({ mode: "parent_pickup_only", morningVanId: "v1", afternoonVanId: null }))).toBe(false);
    // dropoff-only needs only the afternoon van
    expect(needsRouting(row({ mode: "parent_dropoff_only", morningVanId: null, afternoonVanId: null }))).toBe(true);
    expect(needsRouting(row({ mode: "parent_dropoff_only", morningVanId: null, afternoonVanId: "v1" }))).toBe(false);
  });

  it("never flags parent-both, no-mode, or non-attending kids", () => {
    expect(needsRouting(row({ mode: "parent_both", morningVanId: null, afternoonVanId: null }))).toBe(false);
    expect(needsRouting(row({ mode: null, morningVanId: null, afternoonVanId: null }))).toBe(false);
    expect(needsRouting(row({ attending: false, morningVanId: null, afternoonVanId: null }))).toBe(false);
  });
});

describe("boardedStopConflict", () => {
  const am = { morningStopId: "a1", afternoonStopId: "p1" };

  it("blocks changing the morning stop while on the morning van", () => {
    expect(
      boardedStopConflict("van_boarded_am", am, { ...am, morningStopId: "a2" }),
    ).toBe("morning");
  });

  it("blocks changing the afternoon stop while on the afternoon van", () => {
    expect(
      boardedStopConflict("van_boarded_pm", am, { ...am, afternoonStopId: "p2" }),
    ).toBe("afternoon");
  });

  it("allows changing the OTHER leg's stop while boarded (not yet on it)", () => {
    // On the AM van, re-pointing the PM stop is fine — PM leg hasn't started.
    expect(
      boardedStopConflict("van_boarded_am", am, { ...am, afternoonStopId: "p2" }),
    ).toBeNull();
    // On the PM van, the AM leg is already done.
    expect(
      boardedStopConflict("van_boarded_pm", am, { ...am, morningStopId: "a2" }),
    ).toBeNull();
  });

  it("allows a no-op (stop unchanged) even while boarded", () => {
    expect(boardedStopConflict("van_boarded_am", am, am)).toBeNull();
    expect(boardedStopConflict("van_boarded_pm", am, am)).toBeNull();
  });

  it("allows stop changes in every non-boarded state (pre-board call-ahead)", () => {
    for (const state of [
      "not_started",
      "arrived_at_site",
      "site_checked_in",
      "site_checked_out",
      "home",
      "marked_no_show",
    ]) {
      expect(
        boardedStopConflict(state, am, { morningStopId: "a2", afternoonStopId: "p2" }),
      ).toBeNull();
    }
  });
});

describe("planRegionMove", () => {
  const ZONE = "agency-zone";
  const at = (morningStopId: string | null, afternoonStopId: string | null) => ({
    morningStopId,
    afternoonStopId,
  });

  it("points both legs of a full-van kid at the target zone", () => {
    expect(planRegionMove("van", "not_started", at("wrong", "wrong"), ZONE)).toEqual({
      action: "move",
      morningStopId: ZONE,
      afternoonStopId: ZONE,
    });
  });

  it("routes an unassigned van kid (null legs) onto the zone", () => {
    expect(planRegionMove("van", "not_started", at(null, null), ZONE)).toEqual({
      action: "move",
      morningStopId: ZONE,
      afternoonStopId: ZONE,
    });
  });

  it("moves only the leg the mode rides, leaving the other untouched", () => {
    // pickup-only rides the morning van; the afternoon stop stays as-is.
    expect(planRegionMove("parent_pickup_only", "not_started", at("wrong", "p1"), ZONE)).toEqual({
      action: "move",
      morningStopId: ZONE,
      afternoonStopId: "p1",
    });
    // dropoff-only rides the afternoon van; the morning stop stays as-is.
    expect(planRegionMove("parent_dropoff_only", "not_started", at("a1", "wrong"), ZONE)).toEqual({
      action: "move",
      morningStopId: "a1",
      afternoonStopId: ZONE,
    });
  });

  it("is a no-op when the ridden legs already sit on the zone", () => {
    expect(planRegionMove("van", "not_started", at(ZONE, ZONE), ZONE).action).toBe("noop");
    // dropoff-only already on the zone for its one leg → no-op despite a stale AM.
    expect(
      planRegionMove("parent_dropoff_only", "not_started", at("anything", ZONE), ZONE).action,
    ).toBe("noop");
  });

  it("is a no-op for a kid who rides no van (parent_both / null mode)", () => {
    expect(planRegionMove("parent_both", "not_started", at("a1", "p1"), ZONE).action).toBe("noop");
    expect(planRegionMove(null, "not_started", at(null, null), ZONE).action).toBe("noop");
  });

  it("refuses to move a leg the child is currently boarded on", () => {
    expect(planRegionMove("van", "van_boarded_am", at("wrong", "wrong"), ZONE)).toEqual({
      action: "boarded-conflict",
      leg: "morning",
    });
    expect(planRegionMove("van", "van_boarded_pm", at("wrong", "wrong"), ZONE)).toEqual({
      action: "boarded-conflict",
      leg: "afternoon",
    });
  });

  it("still moves the untouched leg's kid when boarded on the OTHER leg", () => {
    // On the AM van but AM stop already correct: only the PM leg changes → safe.
    expect(planRegionMove("van", "van_boarded_am", at(ZONE, "wrong"), ZONE)).toEqual({
      action: "move",
      morningStopId: ZONE,
      afternoonStopId: ZONE,
    });
  });
});
