import { describe, it, expect } from "vitest";
import {
  dayBeforeReminder,
  confirmationOnRegister,
  arrivedAtSite,
  checkedOut,
  noShow,
} from "@/lib/notifications/templates";

const base = {
  guardianName: "Jane",
  studentName: "Joey",
};

describe("notification templates", () => {
  it("dayBeforeReminder includes the student name + time + STOP instructions", () => {
    const r = dayBeforeReminder({ ...base, pickupTime: "7:30 AM", stopName: "First Baptist" });
    expect(r.body).toContain("Joey");
    expect(r.body).toContain("7:30 AM");
    expect(r.body).toContain("First Baptist");
    expect(r.body).toContain("STOP");
  });

  it("confirmationOnRegister addresses the guardian", () => {
    const r = confirmationOnRegister(base);
    expect(r.body).toContain("Jane");
    expect(r.body).toContain("Joey");
  });

  it("arrivedAtSite is short", () => {
    const r = arrivedAtSite(base);
    expect(r.body).toContain("Joey");
    expect(r.body.length).toBeLessThan(80);
  });

  it("checkedOut mentions heading home", () => {
    const r = checkedOut(base);
    expect(r.body.toLowerCase()).toContain("home");
  });

  it("noShow flags the no-show", () => {
    const r = noShow(base);
    expect(r.body).toContain("no-show");
  });

  it("all templates fit a single SMS segment if no extra context is added", () => {
    for (const fn of [arrivedAtSite, checkedOut, noShow]) {
      const r = fn(base);
      expect(r.body.length).toBeLessThanOrEqual(160);
    }
  });
});
