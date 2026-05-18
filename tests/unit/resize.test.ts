import { describe, it, expect } from "vitest";
import { scaledDimensions } from "@/lib/image/resize";

describe("scaledDimensions", () => {
  it("returns the source size if already within the limit", () => {
    expect(scaledDimensions(500, 400, 800)).toEqual({ width: 500, height: 400 });
  });

  it("downscales the long landscape edge to the limit and preserves aspect", () => {
    expect(scaledDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
  });

  it("downscales the long portrait edge", () => {
    expect(scaledDimensions(900, 1800, 800)).toEqual({ width: 400, height: 800 });
  });

  it("handles square images", () => {
    expect(scaledDimensions(2000, 2000, 800)).toEqual({ width: 800, height: 800 });
  });

  it("rounds to integer pixel sizes", () => {
    const r = scaledDimensions(1234, 567, 800);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
  });
});
