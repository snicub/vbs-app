/**
 * Pure helpers for the morning name-tag sheet. No DB / framework imports so
 * this is directly unit-testable and safe to import from client components.
 */

export type NameTag = {
  studentId: string;
  firstName: string;
  lastName: string;
  colorCode: string | null;
  colorName: string | null;
  town: string | null;
  stopName: string | null;
  vanName: string | null;
  wristbandCode: string;
};

type StatusInput = {
  studentId: string;
  morningStopId: string | null;
  afternoonStopId: string | null;
  morningVanId: string | null;
  wristbandColorForDay: string | null;
  wristbandColorName: string | null;
};

type StudentInput = {
  legalFirstName: string;
  legalLastName: string;
  preferredFirstName: string | null;
  wristbandCode: string;
};

type StopInfo = { name: string; town: string };

/** Display rule used app-wide: preferred first name, else legal first name. */
export function displayName(s: {
  preferredFirstName: string | null;
  legalFirstName: string;
  legalLastName: string;
}): { first: string; last: string } {
  const first = (s.preferredFirstName ?? "").trim() || s.legalFirstName;
  return { first, last: s.legalLastName };
}

/**
 * Join today's attending-student statuses with their student/stop/van rows
 * into print-ready tags. The color comes from the day's wristband color
 * (afternoon stop → morning stop, already coalesced by the status view); the
 * town/stop label prefers the morning stop, falling back to the afternoon one.
 */
export function buildTagData(
  statuses: StatusInput[],
  students: Map<string, StudentInput>,
  stops: Map<string, StopInfo>,
  vans: Map<string, string>,
): NameTag[] {
  const tags: NameTag[] = [];
  for (const st of statuses) {
    const stu = students.get(st.studentId);
    if (!stu) continue;

    const { first, last } = displayName(stu);
    const stop =
      (st.morningStopId ? stops.get(st.morningStopId) : undefined) ??
      (st.afternoonStopId ? stops.get(st.afternoonStopId) : undefined) ??
      null;

    tags.push({
      studentId: st.studentId,
      firstName: first,
      lastName: last,
      colorCode: st.wristbandColorForDay,
      colorName: st.wristbandColorName,
      town: stop?.town ?? null,
      stopName: stop?.name ?? null,
      vanName: st.morningVanId ? (vans.get(st.morningVanId) ?? null) : null,
      wristbandCode: stu.wristbandCode,
    });
  }
  return tags;
}

/**
 * Group by color (so same-color tags stack together for distribution), then by
 * name. Tags with no color (parent-both kids) sort last.
 */
export function sortTags(tags: NameTag[]): NameTag[] {
  return tags.slice().sort((a, b) => {
    const ac = a.colorName ?? "￿";
    const bc = b.colorName ?? "￿";
    return (
      ac.localeCompare(bc) ||
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName)
    );
  });
}

/** Pick black or white text for legibility on a given band color. */
export function contrastText(hex: string | null): "#000000" | "#ffffff" {
  const m = hex ? /^#([0-9a-fA-F]{6})$/.exec(hex.trim()) : null;
  if (!m) return "#000000";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
