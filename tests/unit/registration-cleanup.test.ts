import { describe, it, expect } from "vitest";
import { partialFamilyDeletes } from "@/lib/registration/cleanup";

describe("partialFamilyDeletes", () => {
  it("threads the familyId into every delete", () => {
    const deletes = partialFamilyDeletes("fam-123");
    expect(deletes.every((d) => d.value === "fam-123")).toBe(true);
  });

  it("deletes the RESTRICT children before the family row", () => {
    const tables = partialFamilyDeletes("f").map((d) => d.table);
    // families must be LAST — consents and students are ON DELETE RESTRICT,
    // so deleting the family first would error and leave the orphan.
    expect(tables).toEqual(["consents", "students", "families"]);
    expect(tables.indexOf("consents")).toBeLessThan(tables.indexOf("families"));
    expect(tables.indexOf("students")).toBeLessThan(tables.indexOf("families"));
  });

  it("keys the children by family_id and the family by id", () => {
    const deletes = partialFamilyDeletes("f");
    const byTable = Object.fromEntries(deletes.map((d) => [d.table, d.column]));
    expect(byTable.consents).toBe("family_id");
    expect(byTable.students).toBe("family_id");
    expect(byTable.families).toBe("id");
  });

  it("returns exactly the three tables that block or hold the family", () => {
    expect(partialFamilyDeletes("f")).toHaveLength(3);
  });
});
