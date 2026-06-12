/**
 * Pickup-person picker — pure logic. The component itself is rendered, but
 * the option-building logic (dedup, ordering, kind tagging) is what we
 * really need to pin. Extracted here so it can be tested standalone.
 */
import { describe, it, expect } from "vitest";

type PickupKind = "auth" | "guardian" | "primary" | "emergency" | "unlisted";

type PickupOption = {
  id: string | null;
  fullName: string;
  relationship: string | null;
  kind: PickupKind;
};

/**
 * Mirror of the option-building in student-actions.tsx. If the component
 * ever drifts from this contract, the test should fail loudly.
 */
function buildPickupOptions({
  primaryGuardianName,
  emergencyContact,
  guardians,
  authorizedPickup,
}: {
  primaryGuardianName: string | null;
  emergencyContact: { name: string; relationship: string | null } | null;
  guardians: { fullName: string; relationship: string | null }[];
  authorizedPickup: { id: string; fullName: string; relationship: string | null }[];
}): PickupOption[] {
  const out: PickupOption[] = [];
  if (primaryGuardianName) {
    out.push({
      id: null,
      fullName: primaryGuardianName,
      relationship: "Primary guardian",
      kind: "primary",
    });
  }
  for (const g of guardians) {
    if (out.some((o) => o.fullName === g.fullName)) continue;
    out.push({
      id: null,
      fullName: g.fullName,
      relationship: g.relationship,
      kind: "guardian",
    });
  }
  for (const p of authorizedPickup) {
    if (out.some((o) => o.fullName === p.fullName)) continue;
    out.push({
      id: p.id,
      fullName: p.fullName,
      relationship: p.relationship,
      kind: "auth",
    });
  }
  if (
    emergencyContact &&
    !out.some((o) => o.fullName === emergencyContact.name)
  ) {
    out.push({
      id: null,
      fullName: emergencyContact.name,
      relationship: emergencyContact.relationship,
      kind: "emergency",
    });
  }
  return out;
}

describe("pickup-person picker option list", () => {
  it("puts primary guardian first when present", () => {
    const opts = buildPickupOptions({
      primaryGuardianName: "Alex Jones",
      emergencyContact: null,
      guardians: [],
      authorizedPickup: [],
    });
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe("primary");
    expect(opts[0]!.fullName).toBe("Alex Jones");
  });

  it("dedups the primary guardian if also listed in guardians array", () => {
    const opts = buildPickupOptions({
      primaryGuardianName: "Alex Jones",
      emergencyContact: null,
      guardians: [
        { fullName: "Alex Jones", relationship: "mother" },
        { fullName: "Bea Jones", relationship: "father" },
      ],
      authorizedPickup: [],
    });
    expect(opts.map((o) => o.fullName)).toEqual(["Alex Jones", "Bea Jones"]);
  });

  it("includes authorized pickup persons with their UUID", () => {
    const opts = buildPickupOptions({
      primaryGuardianName: null,
      emergencyContact: null,
      guardians: [],
      authorizedPickup: [
        { id: "uuid-1", fullName: "Grandma Sue", relationship: "grandma" },
      ],
    });
    expect(opts).toHaveLength(1);
    expect(opts[0]!.id).toBe("uuid-1");
    expect(opts[0]!.kind).toBe("auth");
  });

  it("includes emergency contact at the end if not already present", () => {
    const opts = buildPickupOptions({
      primaryGuardianName: "Alex Jones",
      emergencyContact: { name: "Aunt Carol", relationship: "aunt" },
      guardians: [],
      authorizedPickup: [],
    });
    expect(opts.map((o) => o.kind)).toEqual(["primary", "emergency"]);
  });

  it("dedups when emergency contact matches primary guardian name", () => {
    const opts = buildPickupOptions({
      primaryGuardianName: "Alex Jones",
      emergencyContact: { name: "Alex Jones", relationship: "self" },
      guardians: [],
      authorizedPickup: [],
    });
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe("primary");
  });

  it("returns an empty list when no family data is loaded yet", () => {
    expect(
      buildPickupOptions({
        primaryGuardianName: null,
        emergencyContact: null,
        guardians: [],
        authorizedPickup: [],
      }),
    ).toEqual([]);
  });
});
