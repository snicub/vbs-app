/**
 * Regression: until this test, /table/[code] offered "Check in" from
 * `not_started`, which the state machine rejects. The fix was to drive
 * action visibility from `isLegalTransition()` directly. This test pins
 * that contract so the bug can't recur.
 */
import { describe, it, expect } from "vitest";
import { isLegalTransition, STATES, type DayState } from "@/lib/events/state-machine";

function actionSurface(state: DayState) {
  return {
    canBoardAm:    isLegalTransition(state, "van_boarded_am"),
    canParentDrop: isLegalTransition(state, "parent_dropoff"),
    canCheckIn:    isLegalTransition(state, "site_checked_in"),
    canCheckOut:
      isLegalTransition(state, "site_checked_out") ||
      isLegalTransition(state, "parent_pickup") ||
      isLegalTransition(state, "van_offloaded_pm"),
    canNoShow:     isLegalTransition(state, "no_show"),
  };
}

describe("table /[code] action surface follows the state machine", () => {
  it("does NOT offer Check-in from not_started (the original bug)", () => {
    expect(actionSurface("not_started").canCheckIn).toBe(false);
  });

  it("offers Board-AM, Parent-dropoff, and No-show from not_started", () => {
    const surface = actionSurface("not_started");
    expect(surface.canBoardAm).toBe(true);
    expect(surface.canParentDrop).toBe(true);
    expect(surface.canNoShow).toBe(true);
  });

  it("offers Check-in from van_boarded_am and arrived_at_site only", () => {
    expect(actionSurface("van_boarded_am").canCheckIn).toBe(true);
    expect(actionSurface("arrived_at_site").canCheckIn).toBe(true);
    expect(actionSurface("site_checked_in").canCheckIn).toBe(false);
    expect(actionSurface("home").canCheckIn).toBe(false);
    expect(actionSurface("marked_no_show").canCheckIn).toBe(false);
  });

  it("offers Check-out only from states with a legal exit", () => {
    expect(actionSurface("site_checked_in").canCheckOut).toBe(true);
    expect(actionSurface("site_checked_out").canCheckOut).toBe(true);
    expect(actionSurface("van_boarded_pm").canCheckOut).toBe(true);
    // Cannot check-out without first being checked in.
    expect(actionSurface("not_started").canCheckOut).toBe(false);
    expect(actionSurface("home").canCheckOut).toBe(false);
  });

  it("offers No-show only from not_started (rest require coordinator override)", () => {
    expect(actionSurface("not_started").canNoShow).toBe(true);
    for (const state of STATES) {
      if (state === "not_started") continue;
      expect(actionSurface(state).canNoShow).toBe(false);
    }
  });

  it("offers no buttons from terminal states", () => {
    for (const state of ["home", "marked_no_show"] as const) {
      const s = actionSurface(state);
      expect(s.canBoardAm || s.canParentDrop || s.canCheckIn || s.canCheckOut || s.canNoShow).toBe(false);
    }
  });
});
