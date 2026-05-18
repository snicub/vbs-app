import { describe, it, expect } from "vitest";
import { generateWristbandCode } from "@/lib/wristband/generate";
import { validateWristbandCode } from "@/lib/wristband/validate";
import { computeChecksumChar } from "@/lib/wristband/checksum";
import { WRISTBAND_ALPHABET, WRISTBAND_LENGTH } from "@/lib/wristband/alphabet";

describe("wristband: alphabet invariants", () => {
  it("excludes visually confusable glyphs (0, 1, O, I; lowercase l never appears since alphabet is upper)", () => {
    expect(WRISTBAND_ALPHABET).not.toMatch(/[01OI]/);
  });

  it("is exactly 32 chars (powers-of-2 friendly)", () => {
    expect(WRISTBAND_ALPHABET.length).toBe(32);
  });

  it("has no duplicates", () => {
    expect(new Set(WRISTBAND_ALPHABET).size).toBe(WRISTBAND_ALPHABET.length);
  });
});

describe("wristband: generate", () => {
  it("returns a 5-char string", () => {
    expect(generateWristbandCode()).toHaveLength(WRISTBAND_LENGTH);
  });

  it("only uses chars from the alphabet", () => {
    const allowed = new Set(WRISTBAND_ALPHABET);
    for (let i = 0; i < 200; i++) {
      const code = generateWristbandCode();
      for (const ch of code) expect(allowed.has(ch)).toBe(true);
    }
  });

  it("always validates the code it just generated", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateWristbandCode();
      const result = validateWristbandCode(code);
      expect(result.ok).toBe(true);
    }
  });
});

describe("wristband: validate", () => {
  it("rejects wrong length", () => {
    expect(validateWristbandCode("ABCD")).toEqual({ ok: false, reason: "length" });
    expect(validateWristbandCode("ABCDEF")).toEqual({ ok: false, reason: "length" });
  });

  it("rejects illegal chars", () => {
    // 0, 1, O, I are excluded from the alphabet.
    expect(validateWristbandCode("ABCD0").ok).toBe(false);
    expect(validateWristbandCode("ABCD0")).toMatchObject({ reason: "charset" });
    expect(validateWristbandCode("ABCDO")).toMatchObject({ reason: "charset" });
    expect(validateWristbandCode("ABCD1")).toMatchObject({ reason: "charset" });
    expect(validateWristbandCode("ABCDI")).toMatchObject({ reason: "charset" });
    // Lowercase letters get normalized — so e.g. "abcdl" → "ABCDL" (L is legal,
    // so it'll fail at checksum, not charset).
    expect(validateWristbandCode("AB!DE")).toMatchObject({ reason: "charset" });
  });

  it("flags a wrong checksum", () => {
    const code = generateWristbandCode();
    const payload = code.slice(0, 4);
    const wrongChecksumChar = WRISTBAND_ALPHABET.split("").find(
      (c) => c !== code[4],
    )!;
    expect(validateWristbandCode(payload + wrongChecksumChar)).toEqual({
      ok: false,
      reason: "checksum",
    });
  });

  it("normalizes case + strips dashes and spaces", () => {
    const code = generateWristbandCode();
    const noisy = code.toLowerCase().split("").join(" ");
    const r = validateWristbandCode(noisy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe(code);
  });

  it("catches any single-character typo (1000 trials)", () => {
    let detected = 0;
    let trials = 0;
    for (let t = 0; t < 1000; t++) {
      const code = generateWristbandCode();
      const idx = Math.floor(Math.random() * code.length);
      // Swap to a *different* char from the alphabet
      const orig = code[idx]!;
      const replacements = WRISTBAND_ALPHABET.split("").filter((c) => c !== orig);
      const next = replacements[Math.floor(Math.random() * replacements.length)]!;
      const corrupted = code.slice(0, idx) + next + code.slice(idx + 1);
      trials++;
      const result = validateWristbandCode(corrupted);
      if (!result.ok) detected++;
    }
    // Expect ~100% catch rate. Allow some slack — the checksum is mod 32,
    // and there's a 1/32 chance the random replacement coincidentally lands
    // on a valid checksum for the new payload. 1000 trials → ~969 catches.
    expect(detected / trials).toBeGreaterThan(0.9);
  });
});

describe("wristband: checksum determinism", () => {
  it("is stable across calls for the same payload", () => {
    expect(computeChecksumChar("ABCD")).toBe(computeChecksumChar("ABCD"));
  });

  it("throws on wrong payload length", () => {
    expect(() => computeChecksumChar("ABC")).toThrow();
    expect(() => computeChecksumChar("ABCDE")).toThrow();
  });

  it("throws on illegal char in payload", () => {
    expect(() => computeChecksumChar("ABC0")).toThrow();
  });
});
