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

/** True when the same person is set as both driver and aide on one van. */
export function sameDriverAndAide(
  driverId: string | null,
  aideId: string | null,
): boolean {
  return driverId !== null && aideId !== null && driverId === aideId;
}

export type RouteSelection = { am: string[]; pm: string[] };
export type DirectionRoute = { van_id: string; direction: "am" | "pm"; stop_ids: string[] };
export type StopConflict = { stopId: string; vanId: string; direction: "am" | "pm" };

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
