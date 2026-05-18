import { describe, it, expect } from "vitest";
import {
  isLegalTransition,
  nextState,
  legalNextEvents,
  isTerminal,
  requiresOverride,
  STATES,
  EVENT_TYPES,
  STATE_LABEL,
  EVENT_LABEL,
  type DayState,
  type EventType,
} from "@/lib/events/state-machine";

describe("state-machine: isLegalTransition", () => {
  it("allows the van-route happy path", () => {
    expect(isLegalTransition("not_started", "van_boarded_am")).toBe(true);
    expect(isLegalTransition("van_boarded_am", "van_offloaded_am")).toBe(true);
    expect(isLegalTransition("arrived_at_site", "site_checked_in")).toBe(true);
    expect(isLegalTransition("site_checked_in", "site_checked_out")).toBe(true);
    expect(isLegalTransition("site_checked_out", "van_boarded_pm")).toBe(true);
    expect(isLegalTransition("van_boarded_pm", "van_offloaded_pm")).toBe(true);
  });

  it("allows the parent-dropoff path", () => {
    expect(isLegalTransition("not_started", "parent_dropoff")).toBe(true);
    expect(isLegalTransition("site_checked_out", "parent_pickup")).toBe(true);
  });

  it("allows no_show only from not_started", () => {
    expect(isLegalTransition("not_started", "no_show")).toBe(true);
    expect(isLegalTransition("site_checked_in", "no_show")).toBe(false);
    expect(isLegalTransition("home", "no_show")).toBe(false);
  });

  it("rejects skipping the offload step", () => {
    expect(isLegalTransition("van_boarded_am", "site_checked_in")).toBe(false);
  });

  it("rejects all forward motion from terminal states", () => {
    for (const event of EVENT_TYPES) {
      if (event === "override") continue;
      expect(isLegalTransition("home", event)).toBe(false);
      expect(isLegalTransition("marked_no_show", event)).toBe(false);
    }
  });

  it("override is always legal", () => {
    for (const state of STATES) {
      expect(isLegalTransition(state, "override")).toBe(true);
    }
  });
});

describe("state-machine: nextState", () => {
  it("maps every concrete event to a state", () => {
    for (const event of EVENT_TYPES) {
      if (event === "override") {
        expect(nextState(event)).toBeNull();
      } else {
        expect(nextState(event)).not.toBeNull();
      }
    }
  });

  it("parent_dropoff lands in site_checked_in (not its own state)", () => {
    expect(nextState("parent_dropoff")).toBe<DayState>("site_checked_in");
  });

  it("parent_pickup and van_offloaded_pm both land in home", () => {
    expect(nextState("parent_pickup")).toBe<DayState>("home");
    expect(nextState("van_offloaded_pm")).toBe<DayState>("home");
  });
});

describe("state-machine: legalNextEvents", () => {
  it("returns empty for terminal states", () => {
    expect(legalNextEvents("home")).toEqual([]);
    expect(legalNextEvents("marked_no_show")).toEqual([]);
  });

  it("not_started offers three forward events", () => {
    const events = legalNextEvents("not_started");
    expect(events).toContain<EventType>("van_boarded_am");
    expect(events).toContain<EventType>("parent_dropoff");
    expect(events).toContain<EventType>("no_show");
    expect(events).toHaveLength(3);
  });
});

describe("state-machine: requiresOverride", () => {
  it("flags skipping middle steps", () => {
    expect(requiresOverride("van_boarded_am", "site_checked_in")).toBe(true);
    expect(requiresOverride("not_started", "site_checked_out")).toBe(true);
  });

  it("does not flag legal transitions", () => {
    expect(requiresOverride("not_started", "van_boarded_am")).toBe(false);
  });
});

describe("state-machine: isTerminal", () => {
  it("flags home and marked_no_show", () => {
    expect(isTerminal("home")).toBe(true);
    expect(isTerminal("marked_no_show")).toBe(true);
  });

  it("does not flag intermediate states", () => {
    expect(isTerminal("site_checked_in")).toBe(false);
    expect(isTerminal("not_started")).toBe(false);
  });
});

describe("state-machine: labels", () => {
  it("has a label for every state", () => {
    for (const state of STATES) {
      expect(STATE_LABEL[state]).toBeTruthy();
    }
  });

  it("has a label for every event", () => {
    for (const event of EVENT_TYPES) {
      expect(EVENT_LABEL[event]).toBeTruthy();
    }
  });
});
