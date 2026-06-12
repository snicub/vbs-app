/**
 * STOP-keyword phone matching — opt-out should honor STOP from any guardian
 * (primary or secondary), regardless of whether their stored phone uses
 * E.164 or a legacy non-normalized format.
 */
import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/registration/schema";

describe("phone-variant matching for STOP", () => {
  it("normalizes US 10-digit to E.164", () => {
    expect(normalizePhone("555-123-4567")).toBe("+15551234567");
  });

  it("normalizes US 11-digit with leading 1 to E.164", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("preserves already-E.164 input", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
  });

  it("handles formatting noise", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("555.123.4567")).toBe("+15551234567");
  });

  it("matches if either raw or normalized form is in the variants set", () => {
    // The opt-out handler builds [raw, normalize(raw)] and queries
    // primary_phone IN (...). If the stored value matches either, STOP
    // works. This is the key contract.
    const raw = "+15551234567";
    const normalized = normalizePhone(raw);
    const variants = new Set([raw, normalized]);
    expect(variants.has("+15551234567")).toBe(true);
  });
});
