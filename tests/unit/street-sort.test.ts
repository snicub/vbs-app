import { describe, it, expect } from "vitest";
import { streetSortKey, compareByStreet } from "@/lib/van-rosters/street-sort";

describe("streetSortKey", () => {
  it("splits house number from street", () => {
    expect(streetSortKey("12447 4th st, Barker hill, SD")).toEqual({
      street: "4th st",
      houseNumber: 12447,
    });
  });

  it("handles a leading # and trailing letters on the house number", () => {
    expect(streetSortKey("#710 barker bill, Agency village")).toEqual({
      street: "barker bill",
      houseNumber: 710,
    });
    expect(streetSortKey("12440tc barker hill")).toEqual({
      street: "barker hill",
      houseNumber: 12440,
    });
  });

  it("street with no number sorts by name, house number = Infinity", () => {
    expect(streetSortKey("barker hill, sisseton")).toEqual({
      street: "barker hill",
      houseNumber: Number.POSITIVE_INFINITY,
    });
  });

  it("missing address sorts last", () => {
    expect(streetSortKey(null).houseNumber).toBe(Number.POSITIVE_INFINITY);
    expect(streetSortKey(null).street > "zzz").toBe(true);
  });
});

describe("compareByStreet", () => {
  it("clusters same street, ordered by house number", () => {
    const addrs = [
      "556 Barker Hill, Sisseton",
      "18 4th st, Barker hill",
      "12447 4th st, Barker hill",
      "551 Barker hill, Sisseton",
    ];
    const sorted = addrs.slice().sort(compareByStreet);
    expect(sorted).toEqual([
      "18 4th st, Barker hill",
      "12447 4th st, Barker hill",
      "551 Barker hill, Sisseton",
      "556 Barker Hill, Sisseton",
    ]);
  });

  it("addresses with no street go last", () => {
    const sorted = ["", "5 Main st", null].sort(compareByStreet);
    expect(sorted[0]).toBe("5 Main st");
  });
});
