import { describe, it, expect } from "vitest";
import {
  buildAgeGroups,
  buildGroups,
  teachersNeeded,
  type GroupKid,
} from "@/lib/coordinator/groups";

const mk = (id: string, age: number | null, last = "L", first = "F"): GroupKid => ({
  studentId: id,
  firstName: first,
  lastName: last,
  age,
  wristbandCode: id.toUpperCase(),
});

function makeKids(ages: number[]): GroupKid[] {
  return ages.map((age, i) => mk(`s${i}`, age));
}

describe("buildGroups", () => {
  it("count mode makes exactly N balanced groups", () => {
    const groups = buildGroups(makeKids(Array(20).fill(8)), { mode: "count", targetSize: 10, groupCount: 4, mix: false });
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.count)).toEqual([5, 5, 5, 5]);
  });
  it("count mode clamps groupCount down to the number of kids", () => {
    const groups = buildGroups(makeKids([5, 6, 7]), { mode: "count", targetSize: 10, groupCount: 10, mix: false });
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });
  it("size mode matches buildAgeGroups (23 @ 10 → 8/8/7)", () => {
    const ages = Array.from({ length: 23 }, (_, i) => 5 + (i % 6));
    const groups = buildGroups(makeKids(ages), { mode: "size", targetSize: 10, groupCount: 1, mix: false });
    expect(groups.map((g) => g.count)).toEqual([8, 8, 7]);
  });
  it("mix mode spreads the age range across every group", () => {
    const kids = [mk("a", 5), mk("b", 6), mk("c", 7), mk("d", 5), mk("e", 6), mk("f", 7)];
    const groups = buildGroups(kids, { mode: "count", targetSize: 10, groupCount: 2, mix: true });
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      const ages = g.kids.map((k) => k.age as number);
      expect(Math.min(...ages)).toBe(5);
      expect(Math.max(...ages)).toBe(7);
    }
  });
  it("mix mode balances sizes (7 kids, 3 groups → 3/2/2)", () => {
    const groups = buildGroups(makeKids([5, 5, 6, 6, 7, 7, 8]), { mode: "count", targetSize: 10, groupCount: 3, mix: true });
    expect(groups.map((g) => g.count).sort((a, b) => b - a)).toEqual([3, 2, 2]);
  });
  it("empty input → no groups", () => {
    expect(buildGroups([], { mode: "size", targetSize: 10, groupCount: 1, mix: false })).toEqual([]);
  });

  it("teachers mode makes one group per team of teachers (8 teachers, 2 each → 4 groups)", () => {
    const groups = buildGroups(makeKids(Array(20).fill(8)), {
      mode: "teachers",
      targetSize: 10,
      groupCount: 1,
      availableTeachers: 8,
      teachersPerGroup: 2,
      mix: false,
    });
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.count)).toEqual([5, 5, 5, 5]);
  });

  it("teachers mode floors leftover staff (7 teachers, 2 each → 3 groups)", () => {
    const groups = buildGroups(makeKids(Array(20).fill(8)), {
      mode: "teachers",
      targetSize: 10,
      groupCount: 1,
      availableTeachers: 7,
      teachersPerGroup: 2,
      mix: false,
    });
    expect(groups).toHaveLength(3);
  });

  it("teachers mode never makes more groups than kids", () => {
    const groups = buildGroups(makeKids([5, 6, 7]), {
      mode: "teachers",
      targetSize: 10,
      groupCount: 1,
      availableTeachers: 100,
      teachersPerGroup: 1,
      mix: false,
    });
    expect(groups).toHaveLength(3);
  });

  it("teachers mode makes at least one group even when staff can't cover a full team", () => {
    const groups = buildGroups(makeKids(Array(12).fill(8)), {
      mode: "teachers",
      targetSize: 10,
      groupCount: 1,
      availableTeachers: 1,
      teachersPerGroup: 2,
      mix: false,
    });
    expect(groups).toHaveLength(1);
  });

  it("teachersPerGroup defaults to 1 when omitted", () => {
    const groups = buildGroups(makeKids(Array(20).fill(8)), {
      mode: "teachers",
      targetSize: 10,
      groupCount: 1,
      availableTeachers: 4,
      mix: false,
    });
    expect(groups).toHaveLength(4);
  });
});

describe("teachersNeeded", () => {
  it("multiplies groups by teachers-per-group", () => {
    expect(teachersNeeded(4, 2)).toBe(8);
  });
  it("defaults to one teacher per group", () => {
    expect(teachersNeeded(3)).toBe(3);
  });
});

describe("buildAgeGroups", () => {
  it("returns no groups for empty input", () => {
    expect(buildAgeGroups([])).toEqual([]);
  });

  it("keeps fewer-than-targetSize kids in a single group", () => {
    const groups = buildAgeGroups(makeKids([5, 6, 7]), 10);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.kids).toHaveLength(3);
  });

  it("splits an exact multiple into even groups", () => {
    const groups = buildAgeGroups(makeKids(Array(20).fill(8)), 10);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.count)).toEqual([10, 10]);
  });

  it("balances rather than leaving a tiny leftover group (23 → 8/8/7)", () => {
    const ages = Array.from({ length: 23 }, (_, i) => 5 + (i % 6));
    const groups = buildAgeGroups(makeKids(ages), 10);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.count)).toEqual([8, 8, 7]);
    // every kid lands in exactly one group
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(23);
  });

  it("puts the larger groups first when sizes are uneven (25 → 9/8/8)", () => {
    const groups = buildAgeGroups(makeKids(Array(25).fill(7)), 10);
    expect(groups.map((g) => g.count)).toEqual([9, 8, 8]);
  });

  it("orders kids by age (youngest first), keeping similar ages together", () => {
    const kids = [mk("a", 9), mk("b", 5), mk("c", 7), mk("d", 6)];
    const groups = buildAgeGroups(kids, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kids.map((k) => k.age)).toEqual([5, 6]);
    expect(groups[1]?.kids.map((k) => k.age)).toEqual([7, 9]);
  });

  it("breaks age ties by name", () => {
    const kids = [mk("a", 6, "Young", "Zoe"), mk("b", 6, "Adams", "Al")];
    const groups = buildAgeGroups(kids, 10);
    expect(groups[0]?.kids.map((k) => k.studentId)).toEqual(["b", "a"]);
  });

  it("sorts kids with an unknown age last", () => {
    const kids = [mk("a", null), mk("b", 8), mk("c", 6)];
    const groups = buildAgeGroups(kids, 10);
    expect(groups[0]?.kids.map((k) => k.studentId)).toEqual(["c", "b", "a"]);
  });

  it("labels groups with their number and age range", () => {
    const groups = buildAgeGroups(makeKids([5, 5, 6, 8, 9, 10]), 3);
    expect(groups[0]?.label).toBe("Group 1 · ages 5–6");
    expect(groups[1]?.label).toBe("Group 2 · ages 8–10");
  });

  it("labels a single-age group with 'age N'", () => {
    const groups = buildAgeGroups(makeKids([7, 7, 7]), 10);
    expect(groups[0]?.label).toBe("Group 1 · age 7");
  });

  it("labels an all-unknown-age group with 'ages —'", () => {
    const groups = buildAgeGroups([mk("a", null), mk("b", null)], 10);
    expect(groups[0]?.label).toBe("Group 1 · ages —");
  });

  it("does not mutate its input", () => {
    const input = [mk("a", 9), mk("b", 5)];
    const order = input.map((k) => k.studentId);
    buildAgeGroups(input, 10);
    expect(input.map((k) => k.studentId)).toEqual(order);
  });
});
