/**
 * Pure filter + sort for the coordinator students roster. Lives outside the
 * component so the rules are directly unit-testable (the table just wires state
 * to these). Generic over the row so it returns the full row type unchanged.
 */

import type { DayState } from "@/lib/events/state-machine";

export type SortKey = "name" | "status" | "dob" | "morningStop" | "afternoonStop";
export type SortDir = "asc" | "desc";

export type StudentFilters = {
  query: string;
  minAge: number | null;
  maxAge: number | null;
  /** A DayState to match, or null for "all statuses". */
  status: string | null;
};

type FilterableRow = {
  firstName: string;
  lastName: string;
  wristbandCode: string;
  familyName: string;
  morningStop: string;
  afternoonStop: string;
  age: number | null;
  dob: string | null;
  state: string;
};

const STATE_RANK: Record<DayState, number> = {
  not_started: 0,
  van_boarded_am: 1,
  arrived_at_site: 2,
  site_checked_in: 3,
  site_checked_out: 4,
  van_boarded_pm: 5,
  home: 6,
  marked_no_show: 7,
};

/** Sort rank for a (possibly unknown) state string — unknowns sort last. */
export function stateRank(state: string): number {
  return STATE_RANK[state as DayState] ?? 99;
}

export function filterStudents<T extends FilterableRow>(rows: T[], f: StudentFilters): T[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (
      q &&
      !(
        r.firstName.toLowerCase().includes(q) ||
        r.lastName.toLowerCase().includes(q) ||
        r.wristbandCode.toLowerCase().includes(q) ||
        r.familyName.toLowerCase().includes(q) ||
        r.morningStop.toLowerCase().includes(q) ||
        r.afternoonStop.toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    // An age range excludes kids with no known age (can't confirm they match).
    if (f.minAge != null || f.maxAge != null) {
      if (r.age == null) return false;
      if (f.minAge != null && r.age < f.minAge) return false;
      if (f.maxAge != null && r.age > f.maxAge) return false;
    }
    if (f.status && r.state !== f.status) return false;
    return true;
  });
}

export function sortStudents<T extends FilterableRow>(
  rows: T[],
  key: SortKey,
  dir: SortDir,
): T[] {
  const sorted = rows.slice().sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
        break;
      case "status":
        cmp = stateRank(a.state) - stateRank(b.state);
        break;
      case "dob":
        cmp = (a.dob ?? "").localeCompare(b.dob ?? "");
        break;
      case "morningStop":
        cmp = a.morningStop.localeCompare(b.morningStop);
        break;
      case "afternoonStop":
        cmp = a.afternoonStop.localeCompare(b.afternoonStop);
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

/** Distinct states present in the roster, in workflow order — drives the
 *  status filter chips so only relevant statuses show. */
export function presentStates(rows: { state: string }[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) seen.add(r.state);
  return Array.from(seen).sort((a, b) => stateRank(a) - stateRank(b));
}
