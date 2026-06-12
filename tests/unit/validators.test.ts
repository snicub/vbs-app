import { describe, it, expect } from "vitest";
import { isValidHexColor } from "@/lib/validators";

describe("isValidHexColor", () => {
  it("accepts 6-digit hex with a leading #", () => {
    expect(isValidHexColor("#ef4444")).toBe(true);
    expect(isValidHexColor("#FFFFFF")).toBe(true);
    expect(isValidHexColor("#aB12Cd")).toBe(true); // mixed case
    expect(isValidHexColor("  #3b82f6  ")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of [
      "ef4444",      // no #
      "#fff",        // 3-digit
      "#abcde",      // 5-digit (too short)
      "#1234567",    // 7-digit (too long)
      "#ff0000ff",   // 8-digit / alpha
      "#GGGGGG",     // non-hex chars
      "#12345g",
      "#12 345",     // internal whitespace
      "#",           // bare hash
      "",
      "#abc",
      "red",
    ]) {
      expect(isValidHexColor(v)).toBe(false);
    }
  });
});
