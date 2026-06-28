import { describe, it, expect } from "vitest";
import { ageFromDob } from "@/lib/registration/age";

describe("ageFromDob", () => {
  it("computes whole years when the birthday has already passed this year", () => {
    expect(ageFromDob("2015-01-10", "2026-06-28")).toBe(11);
  });

  it("subtracts one when the birthday has not yet been reached this year", () => {
    expect(ageFromDob("2015-12-10", "2026-06-28")).toBe(10);
  });

  it("counts the birthday itself as the new age", () => {
    expect(ageFromDob("2015-06-28", "2026-06-28")).toBe(11);
  });

  it("does not count the day before the birthday", () => {
    expect(ageFromDob("2015-06-29", "2026-06-28")).toBe(10);
  });

  it("handles the same month, earlier day (already had birthday)", () => {
    expect(ageFromDob("2015-06-01", "2026-06-28")).toBe(11);
  });

  it("returns 0 for an infant under one year", () => {
    expect(ageFromDob("2026-01-01", "2026-06-28")).toBe(0);
  });

  it("returns null for a blank DOB", () => {
    expect(ageFromDob("", "2026-06-28")).toBeNull();
  });

  it("returns null for an unparseable DOB", () => {
    expect(ageFromDob("not-a-date", "2026-06-28")).toBeNull();
  });

  it("returns null for a future DOB rather than a negative age", () => {
    expect(ageFromDob("2030-01-01", "2026-06-28")).toBeNull();
  });

  it("returns null when DOB is one day in the future", () => {
    expect(ageFromDob("2026-06-29", "2026-06-28")).toBeNull();
  });

  it("returns null for an unparseable reference date", () => {
    expect(ageFromDob("2015-01-10", "")).toBeNull();
  });

  it("handles a leap-day birthday before Feb 29 in a non-leap year", () => {
    expect(ageFromDob("2016-02-29", "2026-02-28")).toBe(9);
  });
});
