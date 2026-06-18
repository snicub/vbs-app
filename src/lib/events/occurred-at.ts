/**
 * Clamp a client-supplied event capture time before it reaches the DB.
 *
 * Offline actions (the van outbox) carry the time they were TAPPED so the
 * timeline and the overdue-van alarms (is_boarded_but_not_arrived,
 * is_pm_van_stuck) measure from when something actually happened, not when it
 * later synced. But a van tablet's clock can run fast — and a future-dated
 * event reorders the derived state and silences those alarms (the deadline is
 * computed forward from the event time). Offline lag is always in the PAST, so
 * we keep a past/equal timestamp and drop anything ahead of the server clock
 * (record_event / smart_checkout then default a missing value to now()).
 *
 * Single home for this rule so submitEvent and smartCheckOut can't drift.
 */
export function clampOccurredAt(
  iso: string | undefined | null,
  nowMs: number,
): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined; // malformed → let the DB stamp now()
  return t <= nowMs ? iso : undefined; // drop a future (fast-clock) timestamp
}
