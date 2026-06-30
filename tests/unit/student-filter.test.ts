import { describe, it, expect } from "vitest";
import {
  filterStudents,
  sortStudents,
  presentStates,
  stateRank,
  type StudentFilters,
} from "@/lib/coordinator/student-filter";

type Row = {
  id: string;
  firstName: string;
  lastName: string;
  wristbandCode: string;
  familyName: string;
  address: string;
  morningStop: string;
  afternoonStop: string;
  age: number | null;
  dob: string | null;
  state: string;
};

const row = (over: Partial<Row> & { id: string }): Row => ({
  firstName: "Ada",
  lastName: "Byron",
  wristbandCode: "AB23X",
  familyName: "Byron",
  address: "1 Main St, Sisseton",
  morningStop: "Maple",
  afternoonStop: "Oak",
  age: 8,
  dob: "2018-01-01",
  state: "not_started",
  ...over,
});

const NO_FILTER: StudentFilters = { query: "", minAge: null, maxAge: null, status: null };

describe("filterStudents — query", () => {
  const rows = [
    row({ id: "1", firstName: "Ada", lastName: "Byron", wristbandCode: "AB23X", familyName: "Byron", morningStop: "Maple" }),
    row({ id: "2", firstName: "Grace", lastName: "Hopper", wristbandCode: "GH99Z", familyName: "Hopper", morningStop: "Oak" }),
  ];
  it("matches by address", () => {
    expect(
      filterStudents([row({ id: "9", address: "705 Old Agency Dr" })], { ...NO_FILTER, query: "old agency" }).map((r) => r.id),
    ).toEqual(["9"]);
  });
  it("matches across first/last/code/family/stop, case-insensitive", () => {
    expect(filterStudents(rows, { ...NO_FILTER, query: "ada" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterStudents(rows, { ...NO_FILTER, query: "HOPPER" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterStudents(rows, { ...NO_FILTER, query: "gh99z" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterStudents(rows, { ...NO_FILTER, query: "maple" }).map((r) => r.id)).toEqual(["1"]);
  });
  it("empty/whitespace query matches everyone", () => {
    expect(filterStudents(rows, { ...NO_FILTER, query: "   " })).toHaveLength(2);
  });
  it("no match → empty", () => {
    expect(filterStudents(rows, { ...NO_FILTER, query: "zzz" })).toHaveLength(0);
  });
});

describe("filterStudents — age range", () => {
  const rows = [
    row({ id: "5", age: 5 }),
    row({ id: "8", age: 8 }),
    row({ id: "12", age: 12 }),
    row({ id: "none", age: null }),
  ];
  it("min only / max only / both", () => {
    expect(filterStudents(rows, { ...NO_FILTER, minAge: 8 }).map((r) => r.id)).toEqual(["8", "12"]);
    expect(filterStudents(rows, { ...NO_FILTER, maxAge: 8 }).map((r) => r.id)).toEqual(["5", "8"]);
    expect(filterStudents(rows, { ...NO_FILTER, minAge: 8, maxAge: 8 }).map((r) => r.id)).toEqual(["8"]);
  });
  it("EXCLUDES unknown-age kids whenever an age bound is set (can't confirm a match)", () => {
    expect(filterStudents(rows, { ...NO_FILTER, minAge: 5 }).map((r) => r.id)).not.toContain("none");
  });
  it("no age bound keeps unknown-age kids", () => {
    expect(filterStudents(rows, NO_FILTER).map((r) => r.id)).toContain("none");
  });
});

describe("filterStudents — status + combined", () => {
  const rows = [
    row({ id: "a", state: "not_started", age: 6 }),
    row({ id: "b", state: "site_checked_in", age: 6 }),
    row({ id: "c", state: "home", age: 10 }),
  ];
  it("filters to a single status", () => {
    expect(filterStudents(rows, { ...NO_FILTER, status: "site_checked_in" }).map((r) => r.id)).toEqual(["b"]);
  });
  it("null status = all", () => {
    expect(filterStudents(rows, NO_FILTER)).toHaveLength(3);
  });
  it("combines query + age + status (all must pass)", () => {
    expect(
      filterStudents(rows, { query: "", minAge: 6, maxAge: 6, status: "site_checked_in" }).map((r) => r.id),
    ).toEqual(["b"]);
    // age 6 excludes c; status excludes a → only b
    expect(filterStudents(rows, { query: "", minAge: 6, maxAge: 6, status: "home" })).toHaveLength(0);
  });
});

describe("sortStudents", () => {
  const rows = [
    row({ id: "h", lastName: "Hopper", firstName: "Grace", state: "home", dob: "2016-05-05", morningStop: "Oak" }),
    row({ id: "b", lastName: "Byron", firstName: "Ada", state: "not_started", dob: "2018-01-01", morningStop: "Maple" }),
  ];
  it("name asc/desc", () => {
    expect(sortStudents(rows, "name", "asc").map((r) => r.id)).toEqual(["b", "h"]);
    expect(sortStudents(rows, "name", "desc").map((r) => r.id)).toEqual(["h", "b"]);
  });
  it("status by workflow rank (not_started before home)", () => {
    expect(sortStudents(rows, "status", "asc").map((r) => r.id)).toEqual(["b", "h"]);
  });
  it("dob ascending (older first)", () => {
    expect(sortStudents(rows, "dob", "asc").map((r) => r.id)).toEqual(["h", "b"]);
  });
  it("does not mutate input", () => {
    const before = rows.map((r) => r.id);
    sortStudents(rows, "name", "desc");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("presentStates + stateRank", () => {
  it("returns distinct states in workflow order", () => {
    const rows = [{ state: "home" }, { state: "not_started" }, { state: "home" }, { state: "site_checked_in" }];
    expect(presentStates(rows)).toEqual(["not_started", "site_checked_in", "home"]);
  });
  it("unknown states rank last", () => {
    expect(stateRank("not_started")).toBeLessThan(stateRank("home"));
    expect(stateRank("gibberish")).toBe(99);
  });
});
