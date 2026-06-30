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

export type MetricKey = keyof DashboardMetrics;

/**
 * One predicate per stat card, evaluated on an attending row. `computeMetrics`
 * counts with these AND the roster filters with these, so tapping a card always
 * shows exactly the kids the number promised.
 */
export const METRIC_MATCHERS: Record<MetricKey, (r: { state: string; hasAnomaly: boolean }) => boolean> = {
  expected: () => true,
  onBoard: (r) => ON_BOARD.has(r.state),
  atSite: (r) => AT_SITE_NOW.has(r.state),
  checkedIn: (r) => REACHED_CHECK_IN.has(r.state),
  home: (r) => r.state === "home",
  noShow: (r) => r.state === "marked_no_show",
  needsAttention: (r) => r.hasAnomaly,
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  expected: "Expected today",
  onBoard: "On a van now",
  atSite: "At site now",
  checkedIn: "Checked in today",
  home: "Home safe",
  noShow: "No-shows",
  needsAttention: "Needs attention",
};

export function isMetricKey(v: string | null | undefined): v is MetricKey {
  return v != null && v in METRIC_MATCHERS;
}

export function computeMetrics(rows: DashStatus[]): DashboardMetrics {
  const att = rows.filter((r) => r.attending);
  const count = (k: MetricKey) => att.filter((r) => METRIC_MATCHERS[k](r)).length;
  return {
    expected: count("expected"),
    onBoard: count("onBoard"),
    atSite: count("atSite"),
    checkedIn: count("checkedIn"),
    home: count("home"),
    noShow: count("noShow"),
    needsAttention: count("needsAttention"),
  };
}

export type VanRow = {
  /** The van's id for linking to its group page; null = parent-drop-off bucket. */
  vanId: string | null;
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
        vanId: onVan ? r.vanId : null,
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
