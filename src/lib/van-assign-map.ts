/**
 * Pure logic for the coordinator "Pickup Map" — turning a day's van-needing kids
 * + the fleet's pickup zones into the view-models the Leaflet map and side list
 * render from.
 *
 * Door-to-door model: each van owns ONE pickup-zone stop that carries the van's
 * color (`color_code`). A kid's CURRENT van is derived (morning_van_id, falling
 * back to afternoon_van_id) — so a pin's color is that van's zone color, or grey
 * when the kid isn't on any van yet. A kid with no usable home coordinates can't
 * be pinned; those are partitioned out so the coordinator handles them by hand
 * (linking to the edit page) — they are never silently dropped from planning.
 */

export const UNASSIGNED_PIN_COLOR = "#9ca3af"; // grey — "not on a van yet"

export type VanZone = {
  vanId: string;
  /** The van's pickup-zone color (its zone stop's color_code), or null if unset. */
  colorCode: string | null;
};

export type KidRow = {
  studentId: string;
  name: string;
  /** Home coordinates; null when un-geocoded. */
  lat: number | null;
  lng: number | null;
  /** Family has a street address on file (so it CAN be geocoded). */
  hasAddress: boolean;
  /** Address was geocoded but didn't match — needs fixing, not just locating. */
  geocodeFailed: boolean;
  /** Current home street + city, to pre-fill the inline address editor. */
  street: string | null;
  city: string | null;
  /** Derived current van for the day: morning_van_id ?? afternoon_van_id. */
  currentVanId: string | null;
};

export type PinnableKid = {
  studentId: string;
  name: string;
  lat: number;
  lng: number;
  street: string | null;
  city: string | null;
  currentVanId: string | null;
  /** The van's zone color, or grey when unassigned / the van has no zone color. */
  currentVanColor: string;
};

export type NoAddressKid = {
  studentId: string;
  name: string;
  /** True = has a street address but isn't geocoded yet (can be "Locate"d). */
  hasAddress: boolean;
  /** True = the address was tried and didn't match; needs fixing, not locating. */
  geocodeFailed: boolean;
  street: string | null;
  city: string | null;
};

export type VanAssignMapData = {
  pinnable: PinnableKid[];
  noAddress: NoAddressKid[];
  /** Families with a street address but no coordinates yet — drives "Locate N homes". */
  locatableCount: number;
};

/** Look up a van's zone color, defaulting to grey when missing. */
export function vanColor(
  vanId: string | null,
  zones: VanZone[],
): string {
  if (!vanId) return UNASSIGNED_PIN_COLOR;
  const zone = zones.find((z) => z.vanId === vanId);
  return zone?.colorCode ?? UNASSIGNED_PIN_COLOR;
}

/**
 * Partition the day's van-needing kids into pinnable (have coordinates) vs.
 * no-address (can't be placed on the map), and resolve each pinnable kid's pin
 * color from their current van's zone. `locatableCount` is the number of kids
 * who have an address but no coordinates yet — the "Locate N homes" target.
 */
export function buildVanAssignMapData(
  kids: KidRow[],
  zones: VanZone[],
): VanAssignMapData {
  const pinnable: PinnableKid[] = [];
  const noAddress: NoAddressKid[] = [];
  let locatableCount = 0;

  for (const k of kids) {
    if (k.lat != null && k.lng != null) {
      pinnable.push({
        studentId: k.studentId,
        name: k.name,
        lat: k.lat,
        lng: k.lng,
        street: k.street,
        city: k.city,
        currentVanId: k.currentVanId,
        currentVanColor: vanColor(k.currentVanId, zones),
      });
    } else {
      // Only count addresses worth a fresh Locate — a failed geocode won't move
      // until the coordinator fixes the address, so it's surfaced separately and
      // kept out of the "Locate N homes" count.
      if (k.hasAddress && !k.geocodeFailed) locatableCount++;
      noAddress.push({
        studentId: k.studentId,
        name: k.name,
        hasAddress: k.hasAddress,
        geocodeFailed: k.geocodeFailed,
        street: k.street,
        city: k.city,
      });
    }
  }

  return { pinnable, noAddress, locatableCount };
}
