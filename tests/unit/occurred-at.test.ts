import { describe, it, expect } from "vitest";
import { clampOccurredAt } from "@/lib/events/occurred-at";

const NOW = Date.parse("2026-06-23T14:00:00.000Z");

describe("clampOccurredAt", () => {
  it("returns undefined for a missing timestamp (DB stamps now)", () => {
    expect(clampOccurredAt(undefined, NOW)).toBeUndefined();
    expect(clampOccurredAt(null, NOW)).toBeUndefined();
    expect(clampOccurredAt("", NOW)).toBeUndefined();
  });

  it("keeps a past timestamp (the normal offline-lag case)", () => {
    const past = "2026-06-23T13:20:00.000Z"; // 40 min before now
    expect(clampOccurredAt(past, NOW)).toBe(past);
  });

  it("keeps a timestamp exactly equal to now", () => {
    const iso = new Date(NOW).toISOString();
    expect(clampOccurredAt(iso, NOW)).toBe(iso);
  });

  it("drops a future timestamp (fast client clock) so it can't silence alarms", () => {
    const future = "2026-06-23T17:00:00.000Z"; // 3h ahead
    expect(clampOccurredAt(future, NOW)).toBeUndefined();
  });

  it("drops even a one-second-future timestamp", () => {
    const future = new Date(NOW + 1000).toISOString();
    expect(clampOccurredAt(future, NOW)).toBeUndefined();
  });

  it("keeps a one-second-past timestamp", () => {
    const past = new Date(NOW - 1000).toISOString();
    expect(clampOccurredAt(past, NOW)).toBe(past);
  });

  it("returns undefined for a malformed string rather than NaN-comparing", () => {
    expect(clampOccurredAt("not-a-date", NOW)).toBeUndefined();
  });

  it("respects a non-UTC offset timestamp that is actually in the past", () => {
    // 08:59 in -05:00 == 13:59Z, one minute before NOW (14:00Z) → kept.
    const past = "2026-06-23T08:59:00-05:00";
    expect(clampOccurredAt(past, NOW)).toBe(past);
  });

  it("drops a non-UTC offset timestamp that resolves to the future", () => {
    // 10:00 in -05:00 == 15:00Z, an hour after NOW → dropped.
    expect(clampOccurredAt("2026-06-23T10:00:00-05:00", NOW)).toBeUndefined();
  });

  it("keeps sub-second precision on a past timestamp verbatim", () => {
    const past = "2026-06-23T13:59:59.250Z";
    expect(clampOccurredAt(past, NOW)).toBe(past);
  });

  it("a long offline lag (hours past) is always kept", () => {
    const longAgo = new Date(NOW - 6 * 3600 * 1000).toISOString();
    expect(clampOccurredAt(longAgo, NOW)).toBe(longAgo);
  });
});
