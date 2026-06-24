/**
 * Pure aggregation for the coordinator dashboard cards. No DB/framework imports
 * so the counting rules are directly unit-testable. The page maps its fetched
 * rows into `DashStatus` and hands them here.
 */

export type DashStatus = {
  state: string;
  hasAnomaly: boolean;
  attending: boolean;
  /** Van the child rides; null = parent drop-off / not on a van yet. */
  vanId: string | null;
  vanName: string | null;
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

export type VanRow = {
  vanName: string;
  colorCode: string | null;
  colorName: string | null;
  expected: number;
  checkedIn: number;
  home: number;
};

const PARENT_KEY = "￿__parent__";
const PARENT_LABEL = "Parent drop-off";

/**
 * Per-van rollup of attending kids: how many ride each van, how many made it
 * in, how many are home. Kids not on a van (parent drop-off, or a van kid not
 * yet assigned) group under "Parent drop-off", always sorted last.
 */
export function computeVanBreakdown(rows: DashStatus[]): VanRow[] {
  const byVan = new Map<string, VanRow>();
  for (const r of rows) {
    if (!r.attending) continue;
    const onVan = r.vanId != null;
    const key = onVan ? r.vanId! : PARENT_KEY;
    let v = byVan.get(key);
    if (!v) {
      v = {
        vanName: onVan ? r.vanName ?? "Van" : PARENT_LABEL,
        colorCode: onVan ? r.colorCode : null,
        colorName: onVan ? r.colorName : null,
        expected: 0,
        checkedIn: 0,
        home: 0,
      };
      byVan.set(key, v);
    }
    v.expected++;
    if (REACHED_CHECK_IN.has(r.state)) v.checkedIn++;
    if (r.state === "home") v.home++;
  }
  return Array.from(byVan.values()).sort((a, b) => {
    const aParent = a.vanName === PARENT_LABEL;
    const bParent = b.vanName === PARENT_LABEL;
    if (aParent !== bParent) return aParent ? 1 : -1;
    return a.vanName.localeCompare(b.vanName);
  });
}
