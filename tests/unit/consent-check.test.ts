import { describe, it, expect } from "vitest";
import { validateConsentSet } from "@/lib/registration/consent-check";

const REQUIRED = ["media_release", "general_liability", "medical"];
const V = "v3";

const ok = (over: { kind: string; textVersion: string }[]) =>
  validateConsentSet(over, REQUIRED, V);

const full = () => [
  { kind: "media_release", textVersion: V },
  { kind: "general_liability", textVersion: V },
  { kind: "medical", textVersion: V },
];

describe("validateConsentSet — version pin", () => {
  it("accepts all-current-version, all-required", () => {
    expect(ok(full())).toEqual({ ok: true });
  });

  it("rejects any consent on an older version (downgrade attempt)", () => {
    const downgraded = full();
    downgraded[2] = { kind: "medical", textVersion: "v1" };
    const r = ok(downgraded);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reload/i);
  });

  it("rejects when every consent is an old version", () => {
    const r = ok(full().map((c) => ({ ...c, textVersion: "v2" })));
    expect(r.ok).toBe(false);
  });
});

describe("validateConsentSet — kind completeness", () => {
  it("rejects a missing required kind", () => {
    const r = ok(full().slice(0, 2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/all required consents/i);
  });

  it("rejects three copies of one kind (count passes, kinds don't)", () => {
    const r = ok([
      { kind: "medical", textVersion: V },
      { kind: "medical", textVersion: V },
      { kind: "medical", textVersion: V },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects an extra (retired) kind alongside the required three", () => {
    const r = ok([...full(), { kind: "transport", textVersion: V }]);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty set", () => {
    expect(ok([]).ok).toBe(false);
  });

  it("version check takes precedence over kind completeness", () => {
    // Missing a kind AND wrong version → still the version message first.
    const r = ok([{ kind: "media_release", textVersion: "v1" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reload/i);
  });
});

describe("validateConsentSet — deep edge cases", () => {
  it("accepts the required kinds in any order", () => {
    expect(
      ok([
        { kind: "medical", textVersion: V },
        { kind: "media_release", textVersion: V },
        { kind: "general_liability", textVersion: V },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects a set whose COUNT is right but whose members are wrong", () => {
    // 3 distinct kinds, but `medical` swapped for a retired `transport`.
    const r = ok([
      { kind: "media_release", textVersion: V },
      { kind: "general_liability", textVersion: V },
      { kind: "transport", textVersion: V },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/all required consents/i);
  });

  it("is case-sensitive on the kind (a mis-cased kind is a missing kind)", () => {
    const r = ok([
      { kind: "Media_Release", textVersion: V },
      { kind: "general_liability", textVersion: V },
      { kind: "medical", textVersion: V },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a single bad version even when all kinds are present and correct", () => {
    const mixed = full();
    mixed[0] = { kind: "media_release", textVersion: "v3-draft" };
    expect(ok(mixed).ok).toBe(false);
  });

  it("rejects four consents (duplicate of a required kind) even if all kinds present", () => {
    const r = ok([...full(), { kind: "medical", textVersion: V }]);
    expect(r.ok).toBe(false);
  });
});
