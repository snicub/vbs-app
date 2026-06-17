/**
 * Pure builder for the parent-pickup picker options. Lives outside the
 * component so the dedupe/order/kind rules are directly unit-testable and the
 * test can't drift from what the component actually offers. The picker feeds
 * parent_pickup metadata (who took the child), so this is release-adjacent —
 * worth real coverage.
 */

export type PickupKind = "auth" | "guardian" | "primary" | "emergency" | "unlisted";

export type PickupOption = {
  id: string | null;
  fullName: string;
  relationship: string | null;
  /** "auth" = authorized_pickup_persons row; "guardian" = guardians row;
   *  "primary" = the family's primary guardian; "emergency" = emergency
   *  contact on the family; "unlisted" = entered free-form by the volunteer. */
  kind: PickupKind;
};

export type PickupOptionInput = {
  primaryGuardianName: string | null;
  emergencyContact: { name: string; relationship: string | null } | null;
  guardians: { fullName: string; relationship: string | null }[];
  authorizedPickup: { id: string; fullName: string; relationship: string | null }[];
};

/**
 * Eligible pickup people, deduped by name, in priority order: primary guardian
 * → secondary guardians → authorized pickup persons → emergency contact. First
 * occurrence of a name wins (so the primary guardian keeps its "Primary
 * guardian" label even if also listed in the guardians array). The volunteer can
 * still enter an unlisted name in the component — that's not produced here.
 */
export function buildPickupOptions(input: PickupOptionInput): PickupOption[] {
  const out: PickupOption[] = [];
  const has = (name: string) => out.some((o) => o.fullName === name);

  if (input.primaryGuardianName) {
    out.push({
      id: null,
      fullName: input.primaryGuardianName,
      relationship: "Primary guardian",
      kind: "primary",
    });
  }
  for (const g of input.guardians) {
    if (has(g.fullName)) continue;
    out.push({ id: null, fullName: g.fullName, relationship: g.relationship, kind: "guardian" });
  }
  for (const p of input.authorizedPickup) {
    if (has(p.fullName)) continue;
    out.push({ id: p.id, fullName: p.fullName, relationship: p.relationship, kind: "auth" });
  }
  if (input.emergencyContact && !has(input.emergencyContact.name)) {
    out.push({
      id: null,
      fullName: input.emergencyContact.name,
      relationship: input.emergencyContact.relationship,
      kind: "emergency",
    });
  }
  return out;
}
