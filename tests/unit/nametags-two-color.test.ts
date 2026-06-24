import { describe, it, expect } from "vitest";
import { buildTagData } from "@/lib/nametags/tag-data";

const students = new Map([
  ["s1", { legalFirstName: "Sam", legalLastName: "Lee", preferredFirstName: null, wristbandCode: "ABCD2" }],
]);
const stops = new Map([
  ["am", { name: "Maple", town: "Maplewood", colorCode: "#ff0000", colorName: "Red" }],
  ["pm", { name: "Oak", town: "Oakdale", colorCode: "#0000ff", colorName: "Blue" }],
]);
const vans = new Map([["v1", "Red Van"]]);

// Door-to-door: each van is one pickup zone, so a normal van kid's AM and PM
// resolve to the SAME van-zone color and the tag is single-band. The two-color
// split below is the rare mixed-mode exception (resolved AM zone color ≠ PM zone
// color — e.g. parent drop-off at one place, vanned home from a different zone).
// Keep this path as the guard for that case; it is no longer the headline.
describe("buildTagData two-color — rare mixed-mode (resolved AM color ≠ PM color)", () => {
  it("exposes both stop colors when AM and PM differ", () => {
    const [tag] = buildTagData(
      [{
        studentId: "s1",
        mode: "van",
        morningStopId: "am",
        afternoonStopId: "pm",
        morningVanId: "v1",
        afternoonVanId: "v1",
        wristbandColorForDay: "#0000ff",
        wristbandColorName: "Blue",
      }],
      students,
      stops,
      vans,
    );
    expect(tag).toBeDefined();
    expect(tag!.morningColorCode).toBe("#ff0000");
    expect(tag!.afternoonColorCode).toBe("#0000ff");
    expect(tag!.morningColorCode).not.toBe(tag!.afternoonColorCode);
  });

  it("same AM and PM stop yields equal colors (single-band case)", () => {
    const [tag] = buildTagData(
      [{
        studentId: "s1",
        mode: "van",
        morningStopId: "am",
        afternoonStopId: "am",
        morningVanId: "v1",
        afternoonVanId: "v1",
        wristbandColorForDay: "#ff0000",
        wristbandColorName: "Red",
      }],
      students,
      stops,
      vans,
    );
    expect(tag!.morningColorCode).toBe(tag!.afternoonColorCode);
  });

  it("no afternoon stop leaves the afternoon color null", () => {
    const [tag] = buildTagData(
      [{
        studentId: "s1",
        mode: "parent_pickup_only",
        morningStopId: "am",
        afternoonStopId: null,
        morningVanId: "v1",
        afternoonVanId: null,
        wristbandColorForDay: "#ff0000",
        wristbandColorName: "Red",
      }],
      students,
      stops,
      vans,
    );
    expect(tag!.morningColorCode).toBe("#ff0000");
    expect(tag!.afternoonColorCode).toBeNull();
  });

  it("no morning stop leaves the morning color null (PM-only kid)", () => {
    const [tag] = buildTagData(
      [{
        studentId: "s1",
        mode: "parent_dropoff_only",
        morningStopId: null,
        afternoonStopId: "pm",
        morningVanId: null,
        afternoonVanId: "v1",
        wristbandColorForDay: "#0000ff",
        wristbandColorName: "Blue",
      }],
      students,
      stops,
      vans,
    );
    expect(tag!.morningColorCode).toBeNull();
    expect(tag!.afternoonColorCode).toBe("#0000ff");
  });

  it("neither stop leaves both per-leg colors null (parent-both kid)", () => {
    const [tag] = buildTagData(
      [{
        studentId: "s1",
        mode: "parent_both",
        morningStopId: null,
        afternoonStopId: null,
        morningVanId: null,
        afternoonVanId: null,
        wristbandColorForDay: null,
        wristbandColorName: null,
      }],
      students,
      stops,
      vans,
    );
    expect(tag!.morningColorCode).toBeNull();
    expect(tag!.afternoonColorCode).toBeNull();
  });
});
