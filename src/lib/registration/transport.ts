/**
 * Transport-mode mapping, kept free of zod (and any heavy deps) so it can be
 * imported into client components — like the signup form — without pulling the
 * validation schemas and their dependencies into the browser bundle.
 */

export type TransportMode =
  | "van"
  | "parent_pickup_only"
  | "parent_dropoff_only"
  | "parent_both";

/**
 * The signup form asks two plain questions — does the child ride the van in the
 * morning, and in the afternoon — and this maps the pair onto the four modes.
 * The legs are independent on purpose: a child can be dropped off by a parent in
 * the morning and ride the van home (parent_dropoff_only), or ride the van in
 * and be picked up by a parent (parent_pickup_only).
 */
export function deriveTransportMode(vanAm: boolean, vanPm: boolean): TransportMode {
  if (vanAm && vanPm) return "van";
  if (vanAm) return "parent_pickup_only";
  if (vanPm) return "parent_dropoff_only";
  return "parent_both";
}
