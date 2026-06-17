/**
 * Pickup-person picker option builder — exercises the REAL buildPickupOptions
 * the component uses (dedup, ordering, kind tagging), so the test can't drift
 * from what the picker actually offers a volunteer.
 */
import { describe, it, expect } from "vitest";
import { buildPickupOptions } from "@/lib/checkin/pickup-options";

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
