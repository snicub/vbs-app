import { describe, it, expect } from "vitest";
import { localPlace } from "@/lib/geocode";

const parts = (city: string | null, street: string | null = null) => ({
  streetAddress: street,
  city,
  state: "SD",
  postalCode: null,
});

describe("localPlace", () => {
  it("resolves Barker Hill (and the Berkery/Barkee misspellings) to the region", () => {
    expect(localPlace(parts("Barker hill"))).toEqual({ lat: 45.581278, lng: -97.061277 });
    expect(localPlace(parts("Berkery Hill"))).toEqual({ lat: 45.581278, lng: -97.061277 });
    expect(localPlace(parts("barkee hill"))).toEqual({ lat: 45.581278, lng: -97.061277 });
  });

  it("resolves the other local reservation towns", () => {
    expect(localPlace(parts("Long Hollows"))).toEqual({ lat: 45.65316, lng: -97.04586 });
    expect(localPlace(parts("Old Agency"))).toEqual({ lat: 45.56781, lng: -97.06721 });
    expect(localPlace(parts("Peever Flat"))).toEqual({ lat: 45.54375, lng: -96.95493 });
  });

  it("matches when the town is written in the street line", () => {
    expect(localPlace(parts(null, "12440 Barker Hill Rd"))).toEqual({ lat: 45.581278, lng: -97.061277 });
  });

  it("returns null for a normal town the geocoder can handle", () => {
    expect(localPlace(parts("Sisseton"))).toBeNull();
    expect(localPlace(parts("Peever"))).toBeNull(); // plain Peever is a real town
    expect(localPlace(parts(null, null))).toBeNull();
  });
});
