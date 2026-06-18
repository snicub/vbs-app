/**
 * VBS event dates. Hardcoded for the one-time event. If the user provides
 * exact dates later, update here and the seed.
 */
export const VBS_DATES: readonly string[] = [
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
];

/**
 * Which VBS day a date-scoped operational screen (dashboard, groups, name tags)
 * should default to. Day-records only exist for the VBS week, so before the
 * event "today" would show an empty day. Clamp into the window: before → day 1,
 * after → last day, during → today. ISO YYYY-MM-DD compares lexicographically =
 * chronologically. An explicit ?date= still overrides this.
 */
export function defaultVbsDate(today: string): string {
  const first = VBS_DATES[0]!;
  const last = VBS_DATES[VBS_DATES.length - 1]!;
  if (today < first) return first;
  if (today > last) return last;
  return today;
}
