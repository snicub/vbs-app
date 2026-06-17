import { describe, it, expect } from "vitest";
import {
  displayName,
  buildTagData,
  sortTags,
  contrastText,
  type NameTag,
} from "@/lib/nametags/tag-data";

describe("displayName", () => {
  it("prefers the preferred first name", () => {
    expect(
      displayName({ preferredFirstName: "Jake", legalFirstName: "Jacob", legalLastName: "Smith" }),
    ).toEqual({ first: "Jake", last: "Smith" });
  });

  it("falls back to legal first name when preferred is null", () => {
    expect(
      displayName({ preferredFirstName: null, legalFirstName: "Jacob", legalLastName: "Smith" }),
    ).toEqual({ first: "Jacob", last: "Smith" });
  });

  it("falls back to legal first name when preferred is blank", () => {
    expect(
      displayName({ preferredFirstName: "  ", legalFirstName: "Jacob", legalLastName: "Smith" }),
    ).toEqual({ first: "Jacob", last: "Smith" });
  });

  it("falls back to legal first name when preferred is an empty string", () => {
    expect(
      displayName({ preferredFirstName: "", legalFirstName: "Jacob", legalLastName: "Smith" }),
    ).toEqual({ first: "Jacob", last: "Smith" });
  });

  it("trims surrounding whitespace from the preferred name", () => {
    expect(
      displayName({ preferredFirstName: "  Jake  ", legalFirstName: "Jacob", legalLastName: "Smith" }),
    ).toEqual({ first: "Jake", last: "Smith" });
  });
});

describe("buildTagData", () => {
  const students = new Map([
    ["s1", { legalFirstName: "Ada", legalLastName: "Byron", preferredFirstName: null, wristbandCode: "AB123" }],
  ]);
  const stops = new Map([["st1", { name: "Maple Town Hall", town: "Maple Falls" }]]);
  const vans = new Map([["v1", "Van 2"]]);

  it("joins status + student + stop + van", () => {
    const tags = buildTagData(
      [{
        studentId: "s1",
        mode: null,
        morningStopId: "st1",
        afternoonStopId: null,
        morningVanId: "v1",
        afternoonVanId: null,
        wristbandColorForDay: "#3b82f6",
        wristbandColorName: "Blue",
      }],
      students, stops, vans,
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Byron",
      town: "Maple Falls",
      vanName: "Van 2",
      colorCode: "#3b82f6",
      colorName: "Blue",
      wristbandCode: "AB123",
    });
  });

  it("handles a parent-both kid: no stop, no van, no color", () => {
    const tags = buildTagData(
      [{
        studentId: "s1",
        mode: null,
        morningStopId: null,
        afternoonStopId: null,
        morningVanId: null,
        afternoonVanId: null,
        wristbandColorForDay: null,
        wristbandColorName: null,
      }],
      students, stops, vans,
    );
    expect(tags[0]).toMatchObject({ town: null, vanName: null, colorCode: null });
  });

  it("falls back to the afternoon stop for the label when there's no morning stop", () => {
    const tags = buildTagData(
      [{
        studentId: "s1",
        mode: null,
        morningStopId: null,
        afternoonStopId: "st1",
        morningVanId: null,
        afternoonVanId: null,
        wristbandColorForDay: "#3b82f6",
        wristbandColorName: "Blue",
      }],
      students, stops, vans,
    );
    expect(tags[0]?.town).toBe("Maple Falls");
  });

  it("skips statuses with no matching student", () => {
    const tags = buildTagData(
      [{
        studentId: "ghost",
        mode: null,
        morningStopId: null,
        afternoonStopId: null,
        morningVanId: null,
        afternoonVanId: null,
        wristbandColorForDay: null,
        wristbandColorName: null,
      }],
      students, stops, vans,
    );
    expect(tags).toHaveLength(0);
  });

  it("returns an empty array for no statuses", () => {
    expect(buildTagData([], students, stops, vans)).toEqual([]);
  });

  it("maps multiple students and preserves input order", () => {
    const many = new Map([
      ["s1", { legalFirstName: "Ada", legalLastName: "Byron", preferredFirstName: null, wristbandCode: "AB123" }],
      ["s2", { legalFirstName: "Bea", legalLastName: "Lovel", preferredFirstName: "Bee", wristbandCode: "CD456" }],
    ]);
    const tags = buildTagData(
      [
        { studentId: "s2", mode: null, morningStopId: "st1", afternoonStopId: null, morningVanId: "v1", afternoonVanId: null, wristbandColorForDay: "#3b82f6", wristbandColorName: "Blue" },
        { studentId: "s1", mode: null, morningStopId: null, afternoonStopId: null, morningVanId: null, afternoonVanId: null, wristbandColorForDay: null, wristbandColorName: null },
      ],
      many, stops, vans,
    );
    expect(tags.map((t) => t.firstName)).toEqual(["Bee", "Ada"]);
  });

  it("flags needsRouting for a van kid missing a van id", () => {
    const tags = buildTagData(
      [{
        studentId: "s1",
        mode: "van",
        morningStopId: null,
        afternoonStopId: null,
        morningVanId: null,
        afternoonVanId: null,
        wristbandColorForDay: null,
        wristbandColorName: null,
      }],
      students, stops, vans,
    );
    expect(tags[0]?.needsRouting).toBe(true);
  });

  it("does not flag needsRouting for a parent-both kid", () => {
    const tags = buildTagData(
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
      students, stops, vans,
    );
    expect(tags[0]?.needsRouting).toBe(false);
  });

  it("does not flag needsRouting for a fully-routed van kid", () => {
    const tags = buildTagData(
      [{
        studentId: "s1",
        mode: "van",
        morningStopId: "st1",
        afternoonStopId: "st1",
        morningVanId: "v1",
        afternoonVanId: "v1",
        wristbandColorForDay: "#3b82f6",
        wristbandColorName: "Blue",
      }],
      students, stops, vans,
    );
    expect(tags[0]?.needsRouting).toBe(false);
  });
});

describe("sortTags", () => {
  const mk = (
    colorName: string | null,
    last: string,
    first: string,
    needsRouting = false,
  ): NameTag => ({
    studentId: `${colorName}-${last}-${first}`,
    firstName: first,
    lastName: last,
    colorCode: colorName ? "#000000" : null,
    colorName,
    morningColorCode: null,
    morningColorName: null,
    afternoonColorCode: null,
    afternoonColorName: null,
    needsRouting,
    town: null,
    vanName: null,
    wristbandCode: "X",
  });

  it("groups by color, then last/first name, with no-color tags last", () => {
    const sorted = sortTags([
      mk("Red", "Adams", "Al"),
      mk(null, "Zane", "Sam"),
      mk("Blue", "Young", "Zoe"),
      mk("Blue", "Adams", "Aaron"),
    ]);
    expect(sorted.map((t) => t.studentId)).toEqual([
      "Blue-Adams-Aaron",
      "Blue-Young-Zoe",
      "Red-Adams-Al",
      "null-Zane-Sam",
    ]);
  });

  it("breaks ties on first name when color and last name match", () => {
    const sorted = sortTags([mk("Blue", "Adams", "Bo"), mk("Blue", "Adams", "Al")]);
    expect(sorted.map((t) => t.firstName)).toEqual(["Al", "Bo"]);
  });

  it("orders multiple no-color tags among themselves by name", () => {
    const sorted = sortTags([mk(null, "Young", "Zoe"), mk(null, "Adams", "Al")]);
    expect(sorted.map((t) => t.lastName)).toEqual(["Adams", "Young"]);
  });

  it("sorts needs-routing tags first regardless of color, then by color/name", () => {
    const sorted = sortTags([
      mk("Blue", "Adams", "Aaron"),
      mk("Red", "Young", "Zed", true),
      mk(null, "Zane", "Sam"),
      mk("Blue", "Abbot", "Ann", true),
    ]);
    // Both needs-routing tags lead (ordered among themselves by color then name:
    // Blue before Red), then the remaining color/name ordering holds.
    expect(sorted.map((t) => t.studentId)).toEqual([
      "Blue-Abbot-Ann",
      "Red-Young-Zed",
      "Blue-Adams-Aaron",
      "null-Zane-Sam",
    ]);
  });

  it("a needs-routing no-color tag still beats a routed color tag", () => {
    const sorted = sortTags([mk("Blue", "Adams", "Aaron"), mk(null, "Zane", "Sam", true)]);
    expect(sorted.map((t) => t.studentId)).toEqual(["null-Zane-Sam", "Blue-Adams-Aaron"]);
  });

  it("does not mutate its input", () => {
    const input = [mk("Red", "B", "b"), mk("Blue", "A", "a")];
    const before = input.map((t) => t.studentId);
    sortTags(input);
    expect(input.map((t) => t.studentId)).toEqual(before);
  });

  it("returns an empty array unchanged", () => {
    expect(sortTags([])).toEqual([]);
  });
});

describe("contrastText", () => {
  it("uses black on light bands, white on dark bands", () => {
    expect(contrastText("#eab308")).toBe("#000000"); // yellow
    expect(contrastText("#a855f7")).toBe("#ffffff"); // purple
    expect(contrastText("#3b82f6")).toBe("#ffffff"); // blue
  });

  it("uses black on the lightest band, white on the darkest", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#22c55e")).toBe("#ffffff"); // green — clearly below the threshold
  });

  it("defaults to black for null, empty, malformed, or alpha hex", () => {
    expect(contrastText(null)).toBe("#000000");
    expect(contrastText("")).toBe("#000000");
    expect(contrastText("nope")).toBe("#000000");
    expect(contrastText("#fff")).toBe("#000000");
    expect(contrastText("#ff0000ff")).toBe("#000000"); // 8-digit / alpha
  });
});
