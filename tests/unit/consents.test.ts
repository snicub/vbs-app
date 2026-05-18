import { describe, it, expect } from "vitest";
import { hashConsentText } from "@/lib/consents/hash";
import { consentText, CONSENT_TEXT, CONSENT_VERSION } from "@/lib/consents/text";

describe("consents: hash", () => {
  it("returns 64 hex chars", async () => {
    const h = await hashConsentText("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await hashConsentText("the quick brown fox");
    const b = await hashConsentText("the quick brown fox");
    expect(a).toBe(b);
  });

  it("changes when text changes", async () => {
    const a = await hashConsentText("text A");
    const b = await hashConsentText("text B");
    expect(a).not.toBe(b);
  });

  it("trailing whitespace flips the hash (no silent normalization)", async () => {
    const a = await hashConsentText("hello");
    const b = await hashConsentText("hello ");
    expect(a).not.toBe(b);
  });
});

describe("consents: text", () => {
  it("has all five required consent kinds for v1", () => {
    const kinds = Object.keys(CONSENT_TEXT.v1);
    expect(kinds).toContain("media_release");
    expect(kinds).toContain("medical");
    expect(kinds).toContain("transport");
    expect(kinds).toContain("general_liability");
    expect(kinds).toContain("photo_release");
  });

  it("consentText(kind) returns the current-version string", () => {
    expect(consentText("medical")).toBe(CONSENT_TEXT[CONSENT_VERSION].medical);
  });
});
