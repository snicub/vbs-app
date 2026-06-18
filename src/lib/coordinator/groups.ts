/**
 * Pure helper for the coordinator's age-based daily class groups. No DB /
 * framework imports so the splitting rules are directly unit-testable.
 *
 * Kids are sorted by age (youngest first), then name, then split into balanced
 * groups of ~targetSize that keep similar ages together. "Balanced" means we
 * never leave a tiny leftover group: 23 kids at targetSize 10 become 8/8/7,
 * not 10/10/3. We do this by choosing the group COUNT from the total, then
 * distributing as evenly as possible (the larger groups come first).
 */

export type GroupKid = {
  studentId: string;
  firstName: string;
  lastName: string;
  age: number | null;
  wristbandCode: string;
};

export type AgeGroup = {
  label: string;
  kids: GroupKid[];
  count: number;
};

/** Kids with a known age sort first (youngest → oldest); unknown ages last. */
function byAgeThenName(a: GroupKid, b: GroupKid): number {
  const aa = a.age ?? Number.POSITIVE_INFINITY;
  const ba = b.age ?? Number.POSITIVE_INFINITY;
  return (
    aa - ba ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName)
  );
}

/** Even-as-possible chunk sizes for `total` items across `groups` groups. */
function balancedSizes(total: number, groups: number): number[] {
  const base = Math.floor(total / groups);
  const remainder = total % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < remainder ? 1 : 0));
}

function ageRangeLabel(kids: GroupKid[]): string {
  const ages = kids.map((k) => k.age).filter((a): a is number => a != null);
  if (ages.length === 0) return "ages —";
  const min = Math.min(...ages);
  const max = Math.max(...ages);
  return min === max ? `age ${min}` : `ages ${min}–${max}`;
}

export type GroupStrategy = {
  /** "size": aim for ~targetSize kids per group. "count": make exactly
   *  groupCount groups. "teachers": make as many groups as the available
   *  teachers can staff (availableTeachers ÷ teachersPerGroup). */
  mode: "size" | "count" | "teachers";
  targetSize: number;
  groupCount: number;
  /** Total teachers on hand — used in "teachers" mode. */
  availableTeachers?: number;
  /** How many teachers staff each group (default 1). Sets the group count in
   *  "teachers" mode and the "teachers needed" total in every mode. */
  teachersPerGroup?: number;
  /** false: keep similar ages together (grade-like classes). true: spread the
   *  age range across every group (mixed/buddy groups). */
  mix: boolean;
};

/** Teachers required to staff `groupCount` groups at `teachersPerGroup` each. */
export function teachersNeeded(groupCount: number, teachersPerGroup = 1): number {
  return groupCount * Math.max(1, Math.floor(teachersPerGroup));
}

export function buildGroups(kids: GroupKid[], strat: GroupStrategy): AgeGroup[] {
  if (kids.length === 0) return [];

  const sorted = kids.slice().sort(byAgeThenName);
  const perGroupTeachers = Math.max(1, Math.floor(strat.teachersPerGroup ?? 1));
  let count: number;
  if (strat.mode === "count") {
    count = Math.floor(strat.groupCount);
  } else if (strat.mode === "teachers") {
    // As many groups as the staff can cover, one team of teachersPerGroup each.
    count = Math.floor((strat.availableTeachers ?? 0) / perGroupTeachers);
  } else {
    // ceil so a group never exceeds targetSize (23 @ 10 → 3 groups, not 2).
    count = Math.ceil(sorted.length / Math.max(1, Math.floor(strat.targetSize)));
  }
  count = Math.max(1, Math.min(count, sorted.length));

  if (strat.mix) {
    // Round-robin the age-sorted kids so each group spans the full range. The
    // first (total % count) buckets get one extra — same balance as below.
    const buckets: GroupKid[][] = Array.from({ length: count }, () => []);
    sorted.forEach((kid, i) => buckets[i % count]!.push(kid));
    return buckets.map((bucket, i) => ({
      label: `Group ${i + 1} · ${ageRangeLabel(bucket)}`,
      kids: bucket,
      count: bucket.length,
    }));
  }

  const sizes = balancedSizes(sorted.length, count);
  const groups: AgeGroup[] = [];
  let offset = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]!;
    const slice = sorted.slice(offset, offset + size);
    offset += size;
    groups.push({
      label: `Group ${i + 1} · ${ageRangeLabel(slice)}`,
      kids: slice,
      count: slice.length,
    });
  }
  return groups;
}

/** Back-compat convenience: balanced age clusters of ~targetSize. */
export function buildAgeGroups(kids: GroupKid[], targetSize = 10): AgeGroup[] {
  return buildGroups(kids, { mode: "size", targetSize, groupCount: 1, mix: false });
}
