import { describe, it, expect } from "vitest";
import { defaultVbsDate, VBS_DATES } from "@/lib/registration/dates";

const FIRST = VBS_DATES[0]!; // 2026-06-30
const LAST = VBS_DATES[VBS_DATES.length - 1]!; // 2026-07-02

describe("defaultVbsDate", () => {
  it("clamps a pre-event date up to day 1 (so the dashboard isn't empty)", () => {
    expect(defaultVbsDate("2026-06-18")).toBe(FIRST);
    expect(defaultVbsDate("2026-01-01")).toBe(FIRST);
    expect(defaultVbsDate("2026-06-29")).toBe(FIRST); // day before
  });

  it("returns today unchanged during the VBS week", () => {
    for (const d of VBS_DATES) {
      expect(defaultVbsDate(d)).toBe(d);
    }
  });

  it("clamps a post-event date down to the last day", () => {
    expect(defaultVbsDate("2026-07-03")).toBe(LAST);
    expect(defaultVbsDate("2026-12-31")).toBe(LAST);
  });
});
