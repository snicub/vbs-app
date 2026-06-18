import { describe, it, expect } from "vitest";
import { defaultVbsDate, VBS_DATES } from "@/lib/registration/dates";

const FIRST = VBS_DATES[0]!; // 2026-06-22
const LAST = VBS_DATES[VBS_DATES.length - 1]!; // 2026-06-26

describe("defaultVbsDate", () => {
  it("clamps a pre-event date up to day 1 (so the dashboard isn't empty)", () => {
    expect(defaultVbsDate("2026-06-18")).toBe(FIRST);
    expect(defaultVbsDate("2026-01-01")).toBe(FIRST);
    expect(defaultVbsDate("2026-06-21")).toBe(FIRST); // day before
  });

  it("returns today unchanged during the VBS week", () => {
    expect(defaultVbsDate("2026-06-22")).toBe("2026-06-22");
    expect(defaultVbsDate("2026-06-24")).toBe("2026-06-24");
    expect(defaultVbsDate("2026-06-26")).toBe("2026-06-26");
  });

  it("clamps a post-event date down to the last day", () => {
    expect(defaultVbsDate("2026-06-27")).toBe(LAST);
    expect(defaultVbsDate("2026-12-31")).toBe(LAST);
  });
});
