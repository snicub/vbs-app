import { describe, it, expect } from "vitest";
import { isStopKeyword, isStartKeyword } from "@/lib/notifications/opt-out";

describe("STOP keyword detection", () => {
  it("matches canonical STOP variants case-insensitively", () => {
    for (const k of ["STOP", "stop", "Stop", " stop  ", "UNSUBSCRIBE", "Cancel", "QUIT", "END", "OPTOUT", "STOPALL"]) {
      expect(isStopKeyword(k)).toBe(true);
    }
  });
  it("does not match other text", () => {
    for (const k of ["hi", "thanks", "STOPMEPLZ", "I want to stop"]) {
      expect(isStopKeyword(k)).toBe(false);
    }
  });
});

describe("START keyword detection", () => {
  it("matches canonical START variants", () => {
    for (const k of ["start", "START", "yes", " UNSTOP "]) {
      expect(isStartKeyword(k)).toBe(true);
    }
  });
});
