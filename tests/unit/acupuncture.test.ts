import { describe, it, expect } from "vitest";
import { matchesAcupuncture } from "@/lib/medical/acupuncture";

describe("matchesAcupuncture", () => {
  it("matches the plain word, any case", () => {
    expect(matchesAcupuncture("Recommends Acupuncture for migraines")).toBe(true);
    expect(matchesAcupuncture("acupuncture")).toBe(true);
  });

  it("matches the common 'accupuncture' misspelling", () => {
    expect(matchesAcupuncture("does accupuncture weekly")).toBe(true);
  });

  it("matches across hyphens/spaces", () => {
    expect(matchesAcupuncture("acu-puncture treatment")).toBe(true);
    expect(matchesAcupuncture("acu puncture")).toBe(true);
  });

  it("matches acupuncturist and acupressure", () => {
    expect(matchesAcupuncture("sees an acupuncturist")).toBe(true);
    expect(matchesAcupuncture("uses an acupressure mat")).toBe(true);
  });

  it("does not match unrelated notes", () => {
    expect(matchesAcupuncture("Peanut allergy, carries an EpiPen")).toBe(false);
    expect(matchesAcupuncture("skin puncture wound last year")).toBe(false);
  });

  it("scans multiple fields and ignores blanks", () => {
    expect(matchesAcupuncture(null, "", "needs acupuncture")).toBe(true);
    expect(matchesAcupuncture(null, undefined, "")).toBe(false);
  });
});
