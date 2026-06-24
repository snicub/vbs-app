/**
 * Pure helpers for the morning name-tag sheet. No DB / framework imports so
 * this is directly unit-testable and safe to import from client components.
 */

import { needsRouting } from "@/lib/routing";

export type NameTag = {
  studentId: string;
  firstName: string;
  lastName: string;
  /** Coalesced day color (afternoon stop → morning stop) — used for the single
   *  band and for sorting. */
  colorCode: string | null;
  colorName: string | null;
  /** Per-leg stop colors, so the tag can show BOTH when they differ. */
  morningColorCode: string | null;
  morningColorName: string | null;
  afternoonColorCode: string | null;
  afternoonColorName: string | null;
  town: string | null;
  vanName: string | null;
  wristbandCode: string;
  /** Rides a van but isn't on one yet — the tag prints a loud "needs routing"
   *  band instead of a calm "Parent drop-off" one, so a van kid awaiting a stop
   *  is never mistaken for a parent-driven kid at distribution. */
  needsRouting: boolean;
};

type StatusInput = {
  studentId: string;
  mode?: string | null;
  morningStopId: string | null;
  afternoonStopId: string | null;
  morningVanId: string | null;
  afternoonVanId?: string | null;
  wristbandColorForDay: string | null;
  wristbandColorName: string | null;
};

type StudentInput = {
  legalFirstName: string;
  legalLastName: string;
  preferredFirstName: string | null;
  wristbandCode: string;
};

type StopInfo = {
  name: string;
  town: string;
  colorCode?: string | null;
  colorName?: string | null;
};

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
 * into print-ready tags. Under door-to-door each van is one pickup zone, so the
 * color comes from that zone (the day's wristband color, afternoon stop →
 * morning stop, already coalesced by the status view) and the tag's headline
 * label is the VAN. `town` is still derived (morning stop → afternoon stop) for
 * the rare stop-less fallback context; per-leg colors are kept so the band can
 * split AM|PM in the rare mixed-mode case where the resolved AM zone color
 * differs from the PM zone color.
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
    const amStop = st.morningStopId ? stops.get(st.morningStopId) : undefined;
    const pmStop = st.afternoonStopId ? stops.get(st.afternoonStopId) : undefined;
    const stop = amStop ?? pmStop ?? null;

    tags.push({
      studentId: st.studentId,
      firstName: first,
      lastName: last,
      colorCode: st.wristbandColorForDay,
      colorName: st.wristbandColorName,
      morningColorCode: amStop?.colorCode ?? null,
      morningColorName: amStop?.colorName ?? null,
      afternoonColorCode: pmStop?.colorCode ?? null,
      afternoonColorName: pmStop?.colorName ?? null,
      town: stop?.town ?? null,
      vanName: st.morningVanId ? (vans.get(st.morningVanId) ?? null) : null,
      wristbandCode: stu.wristbandCode,
      needsRouting: needsRouting({
        mode: st.mode ?? null,
        morningVanId: st.morningVanId,
        afternoonVanId: st.afternoonVanId ?? null,
        attending: true,
      }),
    });
  }
  return tags;
}

/**
 * Needs-routing tags sort first (so the coordinator can't miss a van kid with no
 * stop while handing out tags), then group by color (same-color tags stack
 * together for distribution), then by name. Tags with no color (parent-both
 * kids) sort last.
 */
export function sortTags(tags: NameTag[]): NameTag[] {
  return tags.slice().sort((a, b) => {
    if (a.needsRouting !== b.needsRouting) return a.needsRouting ? -1 : 1;
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
