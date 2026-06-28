import { describe, it, expect } from "vitest";
import {
  ageFor,
  buildVanManifests,
  buildRoster,
  type StatusInput,
  type StudentInput,
  type StopInfo,
  type FamilyInfo,
  type VanInfo,
} from "@/lib/failsafe/print-data";

const students = new Map<string, StudentInput>([
  ["s1", { legalFirstName: "Ada", legalLastName: "Byron", preferredFirstName: null, wristbandCode: "AB123", ageAtRegistration: 9, dob: null, allergies: "Peanuts", medicalNotes: null, familyId: "f1" }],
  ["s2", { legalFirstName: "Grace", legalLastName: "Hopper", preferredFirstName: "Gracie", wristbandCode: "GH456", ageAtRegistration: null, dob: "2018-06-20", allergies: null, medicalNotes: "Inhaler", familyId: "f2" }],
  ["s3", { legalFirstName: "Alan", legalLastName: "Turing", preferredFirstName: null, wristbandCode: "AT789", ageAtRegistration: 7, dob: null, allergies: null, medicalNotes: null, familyId: "f3" }],
]);

const stops = new Map<string, StopInfo>([
  ["stA", { name: "Maple Hall", town: "Maple", colorCode: "#ef4444", colorName: "Red", sortOrder: 0 }],
  ["stB", { name: "Oak Center", town: "Oak", colorCode: "#3b82f6", colorName: "Blue", sortOrder: 1 }],
]);

const families = new Map<string, FamilyInfo>([
  ["f1", { guardianName: "Lord Byron", guardianPhone: "555-0001", address: "1 Poet Ln, Maple, CA, 90001", emergencyName: "Nanny", emergencyPhone: "555-9001" }],
  ["f2", { guardianName: "Mr Hopper", guardianPhone: "555-0002", address: "2 Compiler Rd, Oak, CA, 90002", emergencyName: null, emergencyPhone: null }],
  ["f3", { guardianName: "Mrs Turing", guardianPhone: "555-0003", address: "", emergencyName: "Uncle", emergencyPhone: "555-9003" }],
]);

const vans = new Map<string, VanInfo>([
  ["v1", { name: "Red Van", sortOrder: 0 }],
  ["v2", { name: "Blue Van", sortOrder: 1 }],
]);
const vanList = [
  { id: "v1", name: "Red Van", sortOrder: 0 },
  { id: "v2", name: "Blue Van", sortOrder: 1 },
];

function status(overrides: Partial<StatusInput> & { studentId: string }): StatusInput {
  return {
    attending: true,
    morningStopId: null,
    afternoonStopId: null,
    morningVanId: null,
    afternoonVanId: null,
    wristbandColorForDay: null,
    wristbandColorName: null,
    ...overrides,
    mode: overrides.mode ?? null,
  };
}

describe("ageFor", () => {
  it("prefers explicit registration age", () => {
    expect(ageFor({ ageAtRegistration: 9, dob: "2010-01-01" }, "2026-06-23")).toBe(9);
  });
  it("derives from dob when age is missing", () => {
    expect(ageFor({ ageAtRegistration: null, dob: "2018-06-20" }, "2026-06-23")).toBe(8);
  });
  it("rounds down before the birthday in the reference year", () => {
    expect(ageFor({ ageAtRegistration: null, dob: "2018-06-24" }, "2026-06-23")).toBe(7);
  });
  it("returns null when neither is present", () => {
    expect(ageFor({ ageAtRegistration: null, dob: null }, "2026-06-23")).toBeNull();
  });
});

describe("buildVanManifests", () => {
  it("returns a manifest per active van even when empty", () => {
    const m = buildVanManifests([], students, stops, families, vanList);
    expect(m.map((v) => v.vanName)).toEqual(["Red Van", "Blue Van"]);
    expect(m.every((v) => v.riders.length === 0)).toBe(true);
  });

  it("places a kid on the van for their stop and orders by stop then name", () => {
    const m = buildVanManifests(
      [
        status({ studentId: "s2", morningStopId: "stB", afternoonStopId: "stB", morningVanId: "v1", afternoonVanId: "v1", wristbandColorForDay: "#3b82f6", wristbandColorName: "Blue" }),
        status({ studentId: "s1", morningStopId: "stA", afternoonStopId: "stA", morningVanId: "v1", afternoonVanId: "v1", wristbandColorForDay: "#ef4444", wristbandColorName: "Red" }),
      ],
      students,
      stops,
      families,
      vanList,
    );
    const red = m.find((v) => v.vanId === "v1")!;
    // stA sort 0 comes before stB sort 1.
    expect(red.riders.map((r) => r.name)).toEqual(["Ada Byron", "Gracie Hopper"]);
    expect(red.riders[0]!.direction).toBe("both");
    expect(red.riders[0]!.stopName).toBe("Maple Hall");
    expect(red.riders[0]!.guardianPhone).toBe("555-0001");
    expect(red.riders[0]!.address).toBe("1 Poet Ln, Maple, CA, 90001");
    expect(red.riders[0]!.allergies).toBe("Peanuts");
  });

  it("carries an empty address when the family has none on file", () => {
    const m = buildVanManifests(
      [status({ studentId: "s3", morningStopId: "stA", afternoonStopId: "stA", morningVanId: "v1", afternoonVanId: "v1" })],
      students,
      stops,
      families,
      vanList,
    );
    const red = m.find((v) => v.vanId === "v1")!;
    expect(red.riders[0]!.address).toBe("");
  });

  it("places a kid riding different vans AM and PM on each van", () => {
    const m = buildVanManifests(
      [status({ studentId: "s1", morningStopId: "stA", afternoonStopId: "stB", morningVanId: "v1", afternoonVanId: "v2" })],
      students,
      stops,
      families,
      vanList,
    );
    const red = m.find((v) => v.vanId === "v1")!;
    const blue = m.find((v) => v.vanId === "v2")!;
    expect(red.riders).toHaveLength(1);
    expect(red.riders[0]!.direction).toBe("am");
    expect(blue.riders).toHaveLength(1);
    expect(blue.riders[0]!.direction).toBe("pm");
    expect(blue.riders[0]!.stopName).toBe("Oak Center");
  });

  it("excludes non-attending kids", () => {
    const m = buildVanManifests(
      [status({ studentId: "s1", attending: false, morningStopId: "stA", morningVanId: "v1" })],
      students,
      stops,
      families,
      vanList,
    );
    expect(m.every((v) => v.riders.length === 0)).toBe(true);
  });
});

describe("buildRoster", () => {
  it("sorts by last name and labels van/stop, parent-dropoff, and needs-routing", () => {
    const roster = buildRoster(
      [
        status({ studentId: "s2", mode: "van", morningStopId: "stB", afternoonStopId: "stB", morningVanId: "v2", afternoonVanId: "v2" }),
        // Parent both: no stop, no van needed.
        status({ studentId: "s1", mode: "parent_both" }),
        // Van mode but stop not routed to any van: morningVanId null while stop set.
        status({ studentId: "s3", mode: "van", morningStopId: "stA", afternoonStopId: "stA", morningVanId: null, afternoonVanId: null }),
      ],
      students,
      stops,
      families,
      vans,
      "2026-06-23",
    );
    expect(roster.map((r) => r.lastName)).toEqual(["Byron", "Hopper", "Turing"]);

    const byron = roster.find((r) => r.studentId === "s1")!;
    expect(byron.vanAndStop).toBe("Parent drop-off");
    expect(byron.needsRouting).toBe(false);
    expect(byron.age).toBe(9);

    const hopper = roster.find((r) => r.studentId === "s2")!;
    expect(hopper.vanAndStop).toBe("Blue Van · Oak Center");
    expect(hopper.guardianName).toBe("Mr Hopper");
    expect(hopper.age).toBe(8);

    const turing = roster.find((r) => r.studentId === "s3")!;
    expect(turing.needsRouting).toBe(true);
    expect(turing.vanAndStop).toBe("⚠ NEEDS ROUTING · Maple Hall");
    expect(turing.emergencyPhone).toBe("555-9003");
  });

  it("excludes non-attending kids", () => {
    const roster = buildRoster(
      [status({ studentId: "s1", attending: false })],
      students,
      stops,
      families,
      vans,
      "2026-06-23",
    );
    expect(roster).toHaveLength(0);
  });
});
