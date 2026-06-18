import { describe, it, expect } from "vitest";
import { parentCardState } from "@/lib/parent/card-state";

describe("parentCardState", () => {
  it("shows 'not attending' when there is no day record at all", () => {
    expect(parentCardState(null)).toEqual({ kind: "not_attending" });
  });

  it("shows 'not attending' for a not-attending kid who hasn't started", () => {
    expect(parentCardState({ attending: false, state: "not_started" })).toEqual({
      kind: "not_attending",
    });
  });

  it("shows the real state for an attending kid", () => {
    expect(parentCardState({ attending: true, state: "site_checked_in" })).toEqual({
      kind: "status",
      state: "site_checked_in",
    });
  });

  it("never masks a LIVE state even if the kid is flagged not-attending", () => {
    // Safety: a not-attending flag must not hide a child who is actually
    // checked in or on a van — the live custody/transit state wins.
    expect(parentCardState({ attending: false, state: "site_checked_in" })).toEqual({
      kind: "status",
      state: "site_checked_in",
    });
    expect(parentCardState({ attending: false, state: "van_boarded_pm" })).toEqual({
      kind: "status",
      state: "van_boarded_pm",
    });
  });

  it("normalizes an unknown state to not_started", () => {
    expect(parentCardState({ attending: true, state: "garbage" })).toEqual({
      kind: "status",
      state: "not_started",
    });
  });

  it("an unknown state on a not-attending kid reads as not_attending", () => {
    expect(parentCardState({ attending: false, state: "garbage" })).toEqual({
      kind: "not_attending",
    });
  });

  it("shows a terminal 'home' state for an attending kid", () => {
    expect(parentCardState({ attending: true, state: "home" })).toEqual({
      kind: "status",
      state: "home",
    });
  });

  it("never masks 'home' even when the kid is flagged not-attending (live wins)", () => {
    expect(parentCardState({ attending: false, state: "home" })).toEqual({
      kind: "status",
      state: "home",
    });
  });

  it("shows a no-show as its real state, not as 'not attending'", () => {
    // marked_no_show is a real recorded outcome, not the calm not-attending line.
    expect(parentCardState({ attending: false, state: "marked_no_show" })).toEqual({
      kind: "status",
      state: "marked_no_show",
    });
  });

  it("an empty-string state is normalized to not_started", () => {
    expect(parentCardState({ attending: true, state: "" })).toEqual({
      kind: "status",
      state: "not_started",
    });
  });

  it("an empty-string state on a not-attending kid is the calm line", () => {
    expect(parentCardState({ attending: false, state: "" })).toEqual({ kind: "not_attending" });
  });
});
