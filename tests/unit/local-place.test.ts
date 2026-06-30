import { describe, it, expect } from "vitest";
import { localPlace, parseCoordinate } from "@/lib/geocode";

describe("parseCoordinate", () => {
  it("parses a pasted Google Maps lat,lng", () => {
    expect(parseCoordinate("45.681365, -97.019012")).toEqual({ lat: 45.681365, lng: -97.019012 });
    expect(parseCoordinate("  45.681365,-97.019012  ")).toEqual({ lat: 45.681365, lng: -97.019012 });
  });
  it("finds a coordinate inside a larger string", () => {
    expect(parseCoordinate("45.681365, -97.019012 google maps")).toEqual({
      lat: 45.681365,
      lng: -97.019012,
    });
  });
  it("ignores plain street addresses and blanks", () => {
    expect(parseCoordinate("45 Main St")).toBeNull();
    expect(parseCoordinate("Barker Hill")).toBeNull();
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate(null)).toBeNull();
  });
});

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
    // Peever + Peever Flat merged → one Peever zone.
    expect(localPlace(parts("Peever Flat"))).toEqual({ lat: 45.5391, lng: -96.9578 });
    expect(localPlace(parts("Peever"))).toEqual({ lat: 45.5391, lng: -96.9578 });
  });

  it("matches when the town is written in the street line", () => {
    expect(localPlace(parts(null, "12440 Barker Hill Rd"))).toEqual({ lat: 45.581278, lng: -97.061277 });
  });

  it("the TOWN wins over a street name — Agency Village beats a 'barker' street", () => {
    // Was the live bug: these landed in Barker Hill because of the street.
    expect(localPlace(parts("Agency village", "#710 barker bill"))).toEqual({
      lat: 45.56781,
      lng: -97.06721,
    });
    expect(localPlace(parts("Agency Village", "1055 Little Crow Dr"))).toEqual({
      lat: 45.56781,
      lng: -97.06721,
    });
  });

  it("treats Agency Village as Old Agency", () => {
    expect(localPlace(parts("Agency Village"))).toEqual({ lat: 45.56781, lng: -97.06721 });
  });

  it("falls back to the street only when the town isn't a region (Sisseton + Barker Hill st)", () => {
    expect(localPlace(parts("Sisseton", "556 Barker Hill"))).toEqual({
      lat: 45.581278,
      lng: -97.061277,
    });
  });

  it("Sisseton (no specific region) → the Sisseton-general bucket", () => {
    expect(localPlace(parts("Sisseton"))).toEqual({ lat: 45.663, lng: -97.0481 });
  });

  it("returns null when nothing local is named", () => {
    expect(localPlace(parts("Watertown"))).toBeNull();
    expect(localPlace(parts(null, null))).toBeNull();
  });
});
