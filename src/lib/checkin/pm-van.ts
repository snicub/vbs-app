/**
 * Whether to offer the "Send home on van" checkout for a kid.
 *
 * Only kids whose mode rides the PM van qualify — AND only when a real
 * afternoon van is actually assigned. An un-routed van kid (mode="van" but no
 * van derived for the leg) must NOT get this button: smartCheckOut("van")
 * builds the van_boarded_pm + van_offloaded_pm chain purely from mode/state and
 * never checks for a real afternoon van, so tapping it would mark a
 * physically-present, van-less child "home" — an unaccounted-for kid. Those
 * kids belong on the coordinator's Needs-routing worklist, not on a van.
 */
export type PmVanMode =
  | "van"
  | "parent_dropoff_only"
  | "parent_pickup_only"
  | "parent_both"
  | null;

export function offersPmVanCheckout(
  mode: PmVanMode,
  pmVanAvailable: boolean,
): boolean {
  return (mode === "van" || mode === "parent_dropoff_only") && pmVanAvailable;
}
