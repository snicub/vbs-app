import { describe, it, expect } from "vitest";
import { gpsFreshness } from "@/lib/gps-freshness";

const NOW = 1_700_000_000_000;

describe("gpsFreshness", () => {
  it("fresh within 2 minutes", () => {
    expect(gpsFreshness(NOW - 30_000, NOW)).toBe("fresh");
    expect(gpsFreshness(NOW - 119_000, NOW)).toBe("fresh");
  });
  it("stale between 2 and 10 minutes", () => {
    expect(gpsFreshness(NOW - 120_000, NOW)).toBe("stale");
    expect(gpsFreshness(NOW - 599_000, NOW)).toBe("stale");
  });
  it("dark after 10 minutes", () => {
    expect(gpsFreshness(NOW - 600_000, NOW)).toBe("dark");
    expect(gpsFreshness(NOW - 3_600_000, NOW)).toBe("dark");
  });
  it("clamps future timestamps to fresh", () => {
    expect(gpsFreshness(NOW + 5_000, NOW)).toBe("fresh");
  });
  it("honors custom thresholds", () => {
    expect(gpsFreshness(NOW - 30_000, NOW, { staleAfterSec: 10 })).toBe("stale");
    expect(gpsFreshness(NOW - 30_000, NOW, { staleAfterSec: 10, darkAfterSec: 20 })).toBe("dark");
  });
});
