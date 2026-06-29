/** Pure helpers for van route + assignment editing. */

/**
 * Canonicalize a route's stop selection into the stops' display order, so a
 * route's `stop_ids` array is always stored in a predictable sequence
 * regardless of the order the coordinator clicked the checkboxes.
 */
export function orderStopIds(
  selected: Iterable<string>,
  orderedStops: { id: string }[],
): string[] {
  const set = selected instanceof Set ? selected : new Set(selected);
  return orderedStops.filter((s) => set.has(s.id)).map((s) => s.id);
}

/**
 * True when the same person is named as both driver and aide on one van.
 * Compares trimmed + case-insensitive, and only counts as "same" when both
 * names are non-empty (two blank/None slots never collide).
 */
export function sameDriverAndAide(
  driver: string | null,
  aide: string | null,
): boolean {
  const d = driver?.trim().toLowerCase() ?? "";
  const a = aide?.trim().toLowerCase() ?? "";
  return d !== "" && a !== "" && d === a;
}

export type RouteSelection = { am: string[]; pm: string[] };
export type DirectionRoute = { van_id: string; direction: "am" | "pm"; stop_ids: string[] };
export type StopConflict = { stopId: string; vanId: string; direction: "am" | "pm" };

/**
 * Build the `stops` insert payload for a van's single pickup zone. The zone
 * carries the van's name + color. Scheduled times are left NULL (nullable since
 * migration 0028): door-to-door has no shared van-wide pickup time, and seeding a
 * placeholder would surface a fabricated "8:00 AM" pickup time to every family on
 * the parent status page. The retired late/checked-out alarms read these times
 * too, but they no longer fire (see anomaly.ts), so NULL is harmless there.
 */
export function buildZoneStopInsert(input: { vanName: string; colorCode: string }): {
  name: string;
  town: string;
  color_code: string;
  color_name: string;
  scheduled_am_time: string | null;
  scheduled_pm_time: string | null;
} {
  return {
    name: input.vanName,
    town: input.vanName,
    color_code: input.colorCode,
    color_name: input.vanName,
    scheduled_am_time: null,
    scheduled_pm_time: null,
  };
}

/**
 * A van's pickup zone is the single stop on its route. Resolve that stop id from
 * the van's routes (prefer the AM route, fall back to PM). Returns null when the
 * van has no route stop yet — i.e. it still needs a zone.
 */
export function zoneStopIdForVan(
  vanId: string,
  routes: DirectionRoute[],
): string | null {
  const am = routes.find((r) => r.van_id === vanId && r.direction === "am");
  const pm = routes.find((r) => r.van_id === vanId && r.direction === "pm");
  return am?.stop_ids[0] ?? pm?.stop_ids[0] ?? null;
}

/**
 * Under the door-to-door model every van owns exactly one pickup zone (a stop on
 * both its routes). Given all vans + all routes, return the vans that have no
 * zone stop yet — these need backfilling so kids can ride them.
 */
export function findVansMissingZone(
  vans: { id: string }[],
  routes: DirectionRoute[],
): { id: string }[] {
  return vans.filter((v) => zoneStopIdForVan(v.id, routes) === null);
}

/**
 * A stop may sit on at most one van's route per direction — otherwise the
 * status view's unnest-join maps a child onto two vans at once. Given the van
 * being edited (`selection`) and every OTHER van's routes, return the stops
 * that would collide, so the save can be rejected with a clear message.
 */
export function routeStopConflicts(
  selection: RouteSelection,
  otherRoutes: DirectionRoute[],
): StopConflict[] {
  const incoming = { am: new Set(selection.am), pm: new Set(selection.pm) };
  const conflicts: StopConflict[] = [];
  for (const r of otherRoutes) {
    for (const stopId of r.stop_ids) {
      if (incoming[r.direction].has(stopId)) {
        conflicts.push({ stopId, vanId: r.van_id, direction: r.direction });
      }
    }
  }
  return conflicts;
}
