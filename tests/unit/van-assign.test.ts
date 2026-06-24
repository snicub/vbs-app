import { describe, it, expect } from "vitest";
import { assignLegsForVan } from "@/lib/van-assign";

const ZONE = "11111111-1111-1111-1111-111111111111";
const ZONE2 = "22222222-2222-2222-2222-222222222222";
const empty = { morningStopId: null, afternoonStopId: null };

describe("assignLegsForVan — mode matrix", () => {
  it("van mode sets BOTH legs to the zone stop", () => {
    expect(assignLegsForVan("van", ZONE, empty)).toEqual({
      morning_stop_id: ZONE,
      afternoon_stop_id: ZONE,
    });
  });

  it("parent_pickup_only sets only the morning (AM) leg, clears the afternoon", () => {
    expect(
      assignLegsForVan("parent_pickup_only", ZONE, {
        morningStopId: null,
        afternoonStopId: ZONE2,
      }),
    ).toEqual({ morning_stop_id: ZONE, afternoon_stop_id: null });
  });

  it("parent_dropoff_only sets only the afternoon (PM) leg, clears the morning", () => {
    expect(
      assignLegsForVan("parent_dropoff_only", ZONE, {
        morningStopId: ZONE2,
        afternoonStopId: null,
      }),
    ).toEqual({ morning_stop_id: null, afternoon_stop_id: ZONE });
  });

  it("parent_both rides no van — clears both legs", () => {
    expect(
      assignLegsForVan("parent_both", ZONE, {
        morningStopId: ZONE2,
        afternoonStopId: ZONE2,
      }),
    ).toEqual({ morning_stop_id: null, afternoon_stop_id: null });
  });
});

describe("assignLegsForVan — minimal (non-destructive) updates", () => {
  it("returns an empty patch when the kid is already on this van (van mode)", () => {
    expect(
      assignLegsForVan("van", ZONE, {
        morningStopId: ZONE,
        afternoonStopId: ZONE,
      }),
    ).toEqual({});
  });

  it("only emits the leg that actually changes (re-van from ZONE2 to ZONE)", () => {
    expect(
      assignLegsForVan("van", ZONE, {
        morningStopId: ZONE,
        afternoonStopId: ZONE2,
      }),
    ).toEqual({ afternoon_stop_id: ZONE });
  });

  it("parent_pickup_only already-correct AM leg, null PM → empty patch", () => {
    expect(
      assignLegsForVan("parent_pickup_only", ZONE, {
        morningStopId: ZONE,
        afternoonStopId: null,
      }),
    ).toEqual({});
  });

  it("parent_both already-empty legs → empty patch", () => {
    expect(assignLegsForVan("parent_both", ZONE, empty)).toEqual({});
  });
});
