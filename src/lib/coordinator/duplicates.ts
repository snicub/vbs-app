/**
 * Group students who share the same name so the coordinator can spot a likely
 * double-registration. A shared name is only a HINT (two different kids can
 * share a name), so callers present it as "verify", never an automatic merge.
 */

export type DupMember = { studentId: string; name: string; wristbandCode: string };
export type DupGroup = { key: string; display: string; members: DupMember[] };

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Groups of 2+ students whose names match (case- and whitespace-insensitive). */
export function findDuplicateNames(rows: DupMember[]): DupGroup[] {
  const groups = new Map<string, DupMember[]>();
  for (const r of rows) {
    const key = normalizeName(r.name);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return Array.from(groups.entries())
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, display: members[0]!.name, members }))
    .sort((a, b) => a.display.localeCompare(b.display));
}
