import { describe, it, expect } from "vitest";
import { findDuplicateNames } from "@/lib/coordinator/duplicates";

const m = (studentId: string, name: string, wristbandCode = studentId) => ({
  studentId,
  name,
  wristbandCode,
});

describe("findDuplicateNames", () => {
  it("returns nothing when all names are unique", () => {
    expect(findDuplicateNames([m("1", "Amara Lee"), m("2", "Ben Cho")])).toEqual([]);
  });

  it("groups an exact-name duplicate", () => {
    const groups = findDuplicateNames([m("1", "Jaylah Eastman"), m("2", "Jaylah Eastman")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((x) => x.studentId).sort()).toEqual(["1", "2"]);
  });

  it("matches case- and whitespace-insensitively", () => {
    const groups = findDuplicateNames([m("1", "Kalia  Lufkins"), m("2", "kalia lufkins")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2);
  });

  it("ignores blank names and keeps distinct groups separate", () => {
    const groups = findDuplicateNames([
      m("1", "  "),
      m("2", "Sam Fox"),
      m("3", "Sam Fox"),
      m("4", "Sam Fox"),
      m("5", "Uno Kid"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
  });

  it("sorts groups by display name", () => {
    const groups = findDuplicateNames([
      m("1", "Zed"),
      m("2", "Zed"),
      m("3", "Ana"),
      m("4", "Ana"),
    ]);
    expect(groups.map((g) => g.display)).toEqual(["Ana", "Zed"]);
  });
});
