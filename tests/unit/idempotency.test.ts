import { describe, it, expect } from "vitest";
import { newIdempotencyKey, scopeOf } from "@/lib/idempotency";

describe("idempotency", () => {
  it("generates unique keys", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newIdempotencyKey("checkin"));
    expect(seen.size).toBe(1000);
  });

  it("keys are scope:uuidv7", () => {
    const key = newIdempotencyKey("checkin");
    expect(key).toMatch(/^checkin:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("scopeOf recovers the scope", () => {
    const key = newIdempotencyKey("van_board_am");
    expect(scopeOf(key)).toBe("van_board_am");
  });

  it("rejects illegal scopes", () => {
    expect(() => newIdempotencyKey("")).toThrow();
    expect(() => newIdempotencyKey("has space")).toThrow();
    expect(() => newIdempotencyKey("has:colon")).toThrow();
  });

  it("scopeOf returns null for malformed input", () => {
    expect(scopeOf("no-colon-here")).toBeNull();
    expect(scopeOf("")).toBeNull();
    expect(scopeOf(":startswithcolon")).toBeNull();
  });

  it("keys are time-ordered (uuidv7 property)", () => {
    const first = newIdempotencyKey("checkin");
    // tiny wait — uuidv7 includes a millisecond timestamp
    const second = newIdempotencyKey("checkin");
    // The UUID portion is what's ordered; compare lexicographically.
    const a = first.split(":")[1]!;
    const b = second.split(":")[1]!;
    expect(a <= b).toBe(true);
  });
});
