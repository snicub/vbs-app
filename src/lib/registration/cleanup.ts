/**
 * The order to delete a half-written family in — registerFamily's compensating
 * cleanup when its non-transactional insert chain fails partway (so a mid-chain
 * server blip can't leave an orphan: children invisible on manifests, or a
 * family with no access token the parent can't reach).
 *
 * Order is LOAD-BEARING and mirrors the FK on-delete rules in 0002:
 *  - `consents` and `students` are ON DELETE RESTRICT against `families`, so
 *    they must be removed BEFORE the family row (deleting the family first would
 *    error out and leave the orphan).
 *  - deleting `students` cascades its `student_day_records`.
 *  - removing the `families` row cascades `guardians`, `authorized_pickup_persons`,
 *    and `family_access_tokens`.
 * So three deletes, in this exact order, fully remove the family.
 */

export type FamilyDelete = { table: string; column: string; value: string };

export function partialFamilyDeletes(familyId: string): FamilyDelete[] {
  return [
    { table: "consents", column: "family_id", value: familyId },
    { table: "students", column: "family_id", value: familyId },
    { table: "families", column: "id", value: familyId },
  ];
}
