import { describe, it, expect } from "vitest";
import { offersPmVanCheckout, type PmVanMode } from "@/lib/checkin/pm-van";

describe("offersPmVanCheckout", () => {
  it("offers the van checkout for van-riding modes when a van is assigned", () => {
    expect(offersPmVanCheckout("van", true)).toBe(true);
    expect(offersPmVanCheckout("parent_dropoff_only", true)).toBe(true);
  });

  it("withholds the van checkout when no afternoon van is assigned (the un-routed bug)", () => {
    // An un-routed van kid: mode says van, but no real van — must NOT get a
    // button that fabricates a van chain and falsely marks them home.
    expect(offersPmVanCheckout("van", false)).toBe(false);
    expect(offersPmVanCheckout("parent_dropoff_only", false)).toBe(false);
  });

  it("never offers the van checkout for parent-only modes, van or not", () => {
    for (const available of [true, false]) {
      expect(offersPmVanCheckout("parent_pickup_only", available)).toBe(false);
      expect(offersPmVanCheckout("parent_both", available)).toBe(false);
      expect(offersPmVanCheckout(null, available)).toBe(false);
    }
  });

  it("covers every mode without throwing", () => {
    const modes: PmVanMode[] = [
      "van",
      "parent_dropoff_only",
      "parent_pickup_only",
      "parent_both",
      null,
    ];
    for (const m of modes) {
      expect(typeof offersPmVanCheckout(m, true)).toBe("boolean");
    }
  });
});
