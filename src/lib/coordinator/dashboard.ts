/**
 * Pure aggregation for the coordinator dashboard cards. No DB/framework imports
 * so the counting rules are directly unit-testable. The page maps its fetched
 * rows into `DashStatus` and hands them here.
 */

export type DashStatus = {
  state: string;
  hasAnomaly: boolean;
  attending: boolean;
  /** Town the child rides from; null = parent drop-off / no assigned stop. */
  town: string | null;
  colorCode: string | null;
  colorName: string | null;
};

// Currently sitting on a van (morning or afternoon leg).
const ON_BOARD = new Set(["van_boarded_am", "van_boarded_pm"]);
// Physically present and checked in at the site right now.
const AT_SITE_NOW = new Set(["site_checked_in"]);
// Reached site check-in at any point today (cumulative): checked in, checked
// out, on the ride home, or already home — all imply they made it in.
const REACHED_CHECK_IN = new Set([
  "site_checked_in",
  "site_checked_out",
  "van_boarded_pm",
  "home",
]);

export type DashboardMetrics = {
  expected: number;
  onBoard: number;
  atSite: number;
  checkedIn: number;
  home: number;
  noShow: number;
  needsAttention: number;
};

export function computeMetrics(rows: DashStatus[]): DashboardMetrics {
  const att = rows.filter((r) => r.attending);
  return {
    expected: att.length,
    onBoard: att.filter((r) => ON_BOARD.has(r.state)).length,
    atSite: att.filter((r) => AT_SITE_NOW.has(r.state)).length,
    checkedIn: att.filter((r) => REACHED_CHECK_IN.has(r.state)).length,
    home: att.filter((r) => r.state === "home").length,
    noShow: att.filter((r) => r.state === "marked_no_show").length,
    needsAttention: att.filter((r) => r.hasAnomaly).length,
  };
}

export type TownRow = {
  town: string;
  colorCode: string | null;
  colorName: string | null;
  expected: number;
  checkedIn: number;
  home: number;
};

const PARENT_KEY = "￿__parent__";

/**
 * Per-town rollup of attending kids: how many are coming, how many made it in,
 * how many are home. Kids with no assigned stop group under "Parent drop-off",
 * always sorted last.
 */
export function computeTownBreakdown(rows: DashStatus[]): TownRow[] {
  const byTown = new Map<string, TownRow>();
  for (const r of rows) {
    if (!r.attending) continue;
    const key = r.town ?? PARENT_KEY;
    let t = byTown.get(key);
    if (!t) {
      t = {
        town: r.town ?? "Parent drop-off",
        colorCode: r.town ? r.colorCode : null,
        colorName: r.town ? r.colorName : null,
        expected: 0,
        checkedIn: 0,
        home: 0,
      };
      byTown.set(key, t);
    }
    t.expected++;
    if (REACHED_CHECK_IN.has(r.state)) t.checkedIn++;
    if (r.state === "home") t.home++;
  }
  return Array.from(byTown.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}
