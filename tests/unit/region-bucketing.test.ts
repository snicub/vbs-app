import { describe, it, expect } from "vitest";
import { localPlace, parseCoordinate, type GeoPoint } from "@/lib/geocode";

/**
 * REGRESSION SUITE for "kids ended up in the wrong van bucket" (the biggest miss
 * on day 1, 6/30/2026). The region a kid rides is decided by which van zone their
 * home resolves nearest to; localPlace is what maps a reservation-town address to
 * its region center. The core rule that broke: the TOWN field decides the region,
 * and only when the town names no region do we fall back to the street.
 *
 * Each region's center (keep in sync with the van zones / LOCAL_TOWNS).
 */
const BARKER_HILL: GeoPoint = { lat: 45.581278, lng: -97.061277 };
const LONG_HOLLOWS: GeoPoint = { lat: 45.65316, lng: -97.04586 };
const OLD_AGENCY: GeoPoint = { lat: 45.56781, lng: -97.06721 };
const PEEVER: GeoPoint = { lat: 45.5391, lng: -96.9578 };
const SISSETON: GeoPoint = { lat: 45.663, lng: -97.0481 };

const parts = (city: string | null, street: string | null = null) => ({
  streetAddress: street,
  city,
  state: "SD",
  postalCode: null,
});

type Case = { desc: string; city: string | null; street: string | null; want: GeoPoint | null };

const cases: Case[] = [
  // --- THE BUG: town names a region, street names a DIFFERENT one → TOWN wins ---
  { desc: "Henslee — Agency Village town beats a 'barker bill' street → Old Agency", city: "Agency village", street: "#710 barker bill", want: OLD_AGENCY },
  { desc: "Jaylah — Agency Village town, ordinary street → Old Agency", city: "Agency village", street: "1055 Little Crow Dr", want: OLD_AGENCY },
  { desc: "Gabriel — Peever Flats town beats an ordinary street → Peever", city: "Peever flats", street: "409 labatte dr", want: PEEVER },
  { desc: "town Barker Hill beats an 'old agency' street → Barker Hill", city: "Barker Hill", street: "12 Old Agency Rd", want: BARKER_HILL },
  { desc: "town Long Hollows beats a 'peever' street → Long Hollows", city: "Long Hollows", street: "5 Peever Ln", want: LONG_HOLLOWS },

  // --- Town clearly names a region (the normal, must-stay-right cases) ---
  { desc: "Barker hill town", city: "Barker hill", street: "12440tc barker hill", want: BARKER_HILL },
  { desc: "Old Agency town", city: "Old Agency", street: "252 Old Agency", want: OLD_AGENCY },
  { desc: "Long Hollows town", city: "Long Hollows", street: "9 Hollow Rd", want: LONG_HOLLOWS },
  { desc: "Peever town (plain, not Flats)", city: "Peever", street: "1 Main", want: PEEVER },
  { desc: "Peever Flat town", city: "Peever Flat", street: "1 Main", want: PEEVER },

  // --- Town typos that still must resolve ---
  { desc: "barker bill mistype as town", city: "barker bill", street: null, want: BARKER_HILL },
  { desc: "berker hill mistype as town", city: "berker hill", street: null, want: BARKER_HILL },
  { desc: "barkee hill mistype as town", city: "barkee hill", street: null, want: BARKER_HILL },
  { desc: "barkerhill no-space as town", city: "barkerhill", street: null, want: BARKER_HILL },
  { desc: "Agency Village (any case) as town", city: "agency VILLAGE", street: null, want: OLD_AGENCY },

  // --- Town is NOT a region (Sisseton / typos) → fall back to the STREET ---
  { desc: "Eastman — Sisseton town, Barker Hill street → Barker Hill", city: "Sisseton", street: "556 Barker Hill", want: BARKER_HILL },
  { desc: "Shantelle — Sisseton town, Old Agency street → Old Agency", city: "Sisseton", street: "705 old agency dr", want: OLD_AGENCY },
  { desc: "Dazen — Sisseron typo town, 'berker hill' street → Barker Hill", city: "Sisseron SD", street: "707 berker hill", want: BARKER_HILL },
  { desc: "Miles — Sissteon typo town, barker hill street → Barker Hill", city: "Sissteon", street: "551 Barker hill", want: BARKER_HILL },
  { desc: "town null, region in the street line", city: null, street: "12440 Barker Hill Rd", want: BARKER_HILL },

  // --- In-town Sisseton with no specific region → the Sisseton-general bucket ---
  { desc: "Sisseton in-town, no specific region → Sisseton general", city: "Sisseton", street: "123 Main St", want: SISSETON },
  { desc: "Sisseron typo town, no specific region → Sisseton general", city: "Sisseron", street: "5 Elm", want: SISSETON },

  // --- Neither town nor street names anything we know → null (flagged) ---
  { desc: "empty address → null", city: null, street: null, want: null },
  { desc: "out-of-area town → null", city: "Watertown", street: "1 Oak", want: null },
];

describe("region bucketing — localPlace (town-first)", () => {
  it.each(cases)("$desc", ({ city, street, want }) => {
    expect(localPlace(parts(city, street))).toEqual(want);
  });

  it("a 'barker' STREET must NOT override an Agency Village TOWN (the live bug)", () => {
    // The exact shape that sent Old Agency kids to Barker Hill on day 1.
    expect(localPlace(parts("Agency village", "#710 barker bill"))).not.toEqual(BARKER_HILL);
    expect(localPlace(parts("Agency village", "#710 barker bill"))).toEqual(OLD_AGENCY);
  });
});

describe("region bucketing — pasted Google Maps coordinate", () => {
  it("uses a pasted lat,lng exactly (custom pickup point)", () => {
    expect(parseCoordinate("45.681365, -97.019012")).toEqual({ lat: 45.681365, lng: -97.019012 });
    expect(parseCoordinate("45.681365,-97.019012 google maps")).toEqual({
      lat: 45.681365,
      lng: -97.019012,
    });
  });
  it("does not mistake a street number for a coordinate", () => {
    expect(parseCoordinate("45 Main St")).toBeNull();
    expect(parseCoordinate("710 Barker Hill")).toBeNull();
    expect(parseCoordinate(null)).toBeNull();
  });
});
