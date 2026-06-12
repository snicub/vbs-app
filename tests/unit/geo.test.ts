/**
 * Geo helpers — distance + ETA. Tested against known-good fixtures and
 * the null-input edge cases used by the parent page.
 */
import { describe, it, expect } from "vitest";
import { haversineMeters, estimatedEtaSeconds, formatEta } from "@/lib/geo";

describe("haversineMeters", () => {
  it("computes a known distance (Sioux Falls SD → Brandon SD ≈ 13km)", () => {
    const d = haversineMeters(43.5446, -96.7311, 43.5944, -96.5739);
    expect(d).toBeGreaterThan(12_000);
    expect(d).toBeLessThan(16_000);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMeters(40, -80, 40, -80)).toBe(0);
  });

  it("is symmetric", () => {
    const a = haversineMeters(40, -80, 41, -81);
    const b = haversineMeters(41, -81, 40, -80);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});

describe("estimatedEtaSeconds", () => {
  it("returns null when any coord is null", () => {
    expect(estimatedEtaSeconds(null, null, 40, -80)).toBeNull();
    expect(estimatedEtaSeconds(40, -80, null, null)).toBeNull();
    expect(estimatedEtaSeconds(40, null, 40, -80)).toBeNull();
  });

  it("computes a sane ETA for 10km at ~25mph (≈ 22 min driving)", () => {
    // 10km straight-line × 1.4 inflation ÷ 11 m/s ≈ 1273 s ≈ 21 min
    const eta = estimatedEtaSeconds(43.5446, -96.7311, 43.5944, -96.5739);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(20 * 60);
    expect(eta!).toBeLessThan(35 * 60);
  });

  it("returns 0-ish for identical points", () => {
    expect(estimatedEtaSeconds(40, -80, 40, -80)).toBe(0);
  });
});

describe("formatEta", () => {
  it("returns null for null", () => {
    expect(formatEta(null)).toBeNull();
  });
  it("formats <1 min for sub-minute", () => {
    expect(formatEta(30)).toBe("<1 min");
  });
  it("formats minutes-only under 1 hour", () => {
    expect(formatEta(60 * 8)).toBe("8 min");
    expect(formatEta(60 * 59 + 20)).toBe("59 min");
  });
  it("formats hours + minutes over 1 hour", () => {
    expect(formatEta(60 * 65)).toBe("1 hr 5 min");
    expect(formatEta(60 * 125)).toBe("2 hr 5 min");
  });
});
