/**
 * Pure helpers for the Sunday-night paper failsafe (`/coordinator/print`).
 * No DB / framework imports so this is directly unit-testable and safe to
 * import from a client component.
 *
 * Two artifacts are derived here from the same attending-student rows:
 *   - per-van manifests (who rides each active van today, AM/PM), and
 *   - a master roster of every attending kid with contacts + medical.
 *
 * Van membership is DERIVED, never stored: a kid rides the van whose route
 * includes their stop, surfaced as morning_van_id / afternoon_van_id on the
 * student_day_status view. A van-mode kid whose stop has not been routed yet
 * has a null van — those must never be silently dropped, so the master roster
 * collects them under a dedicated "needs routing" group.
 */

import { displayName } from "@/lib/nametags/tag-data";
import { needsRouting } from "@/lib/routing";

export type StatusInput = {
  studentId: string;
  attending: boolean;
  mode: string | null;
  morningStopId: string | null;
  afternoonStopId: string | null;
  morningVanId: string | null;
  afternoonVanId: string | null;
  wristbandColorForDay: string | null;
  wristbandColorName: string | null;
};

export type StudentInput = {
  legalFirstName: string;
  legalLastName: string;
  preferredFirstName: string | null;
  wristbandCode: string;
  ageAtRegistration: number | null;
  dob: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  familyId: string;
};

export type StopInfo = {
  name: string;
  town: string;
  colorCode: string;
  colorName: string;
  sortOrder: number;
};

export type VanInfo = { name: string; sortOrder: number };

export type FamilyInfo = {
  guardianName: string;
  guardianPhone: string;
  emergencyName: string | null;
  emergencyPhone: string | null;
};

export type ManifestRider = {
  studentId: string;
  name: string;
  wristbandCode: string;
  direction: "am" | "pm" | "both";
  stopName: string | null;
  colorCode: string | null;
  colorName: string | null;
  guardianPhone: string;
  allergies: string | null;
  medicalNotes: string | null;
  stopOrder: number;
};

export type VanManifest = {
  vanId: string;
  vanName: string;
  riders: ManifestRider[];
};

export type RosterEntry = {
  studentId: string;
  name: string;
  lastName: string;
  wristbandCode: string;
  age: number | null;
  vanAndStop: string;
  guardianName: string;
  guardianPhone: string;
  emergencyName: string | null;
  emergencyPhone: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  needsRouting: boolean;
};

/** Best-available age: explicit registration age, else derived from dob. */
export function ageFor(
  student: { ageAtRegistration: number | null; dob: string | null },
  on: string,
): number | null {
  if (student.ageAtRegistration != null) return student.ageAtRegistration;
  if (!student.dob) return null;
  const born = new Date(student.dob + "T00:00:00");
  const ref = new Date(on + "T00:00:00");
  if (Number.isNaN(born.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - born.getFullYear();
  const m = ref.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Build one manifest per active van, with riders ordered by stop order then
 * name. A kid on a van AM only / PM only / both is placed on each van they
 * touch; the stop shown for a van is the stop that put them on that van.
 */
export function buildVanManifests(
  statuses: StatusInput[],
  students: Map<string, StudentInput>,
  stops: Map<string, StopInfo>,
  families: Map<string, FamilyInfo>,
  vans: { id: string; name: string; sortOrder: number }[],
): VanManifest[] {
  const ridersByVan = new Map<string, ManifestRider[]>();

  for (const st of statuses) {
    if (!st.attending) continue;
    const stu = students.get(st.studentId);
    if (!stu) continue;

    const { first, last } = displayName(stu);
    const fam = families.get(stu.familyId);
    const guardianPhone = fam?.guardianPhone ?? "";

    const onAm = st.morningVanId != null;
    const onPm = st.afternoonVanId != null;
    const sameVan = onAm && onPm && st.morningVanId === st.afternoonVanId;

    const placements: { vanId: string; stopId: string | null; direction: ManifestRider["direction"] }[] = [];
    if (sameVan) {
      placements.push({ vanId: st.morningVanId!, stopId: st.morningStopId, direction: "both" });
    } else {
      if (onAm) placements.push({ vanId: st.morningVanId!, stopId: st.morningStopId, direction: "am" });
      if (onPm) placements.push({ vanId: st.afternoonVanId!, stopId: st.afternoonStopId, direction: "pm" });
    }

    for (const p of placements) {
      const stop = p.stopId ? stops.get(p.stopId) : undefined;
      const rider: ManifestRider = {
        studentId: st.studentId,
        name: `${first} ${last}`,
        wristbandCode: stu.wristbandCode,
        direction: p.direction,
        stopName: stop?.name ?? null,
        colorCode: st.wristbandColorForDay,
        colorName: st.wristbandColorName,
        guardianPhone,
        allergies: stu.allergies,
        medicalNotes: stu.medicalNotes,
        stopOrder: stop?.sortOrder ?? Number.POSITIVE_INFINITY,
      };
      const list = ridersByVan.get(p.vanId);
      if (list) list.push(rider);
      else ridersByVan.set(p.vanId, [rider]);
    }
  }

  return vans
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((v) => ({
      vanId: v.id,
      vanName: v.name,
      riders: (ridersByVan.get(v.id) ?? []).sort(
        (a, b) =>
          a.stopOrder - b.stopOrder ||
          a.name.localeCompare(b.name),
      ),
    }));
}

/**
 * Build the master roster: every attending kid, sorted by last name. The
 * van/stop label prefers the morning placement, then afternoon, else "Parent
 * drop-off". A kid who rides a van but isn't on one — no stop assigned yet, or a
 * stop that isn't on any route — is flagged `needsRouting` (the shared, mode-
 * aware rule) and labeled loudly instead of being mislabeled "Parent drop-off".
 * Losing such a kid off the printed sheet is the exact failure this failsafe
 * guards against, so they must never read as parent-driven.
 */
export function buildRoster(
  statuses: StatusInput[],
  students: Map<string, StudentInput>,
  stops: Map<string, StopInfo>,
  families: Map<string, FamilyInfo>,
  vans: Map<string, VanInfo>,
  eventDate: string,
): RosterEntry[] {
  const entries: RosterEntry[] = [];

  for (const st of statuses) {
    if (!st.attending) continue;
    const stu = students.get(st.studentId);
    if (!stu) continue;

    const { first, last } = displayName(stu);
    const fam = families.get(stu.familyId);

    const stopId = st.morningStopId ?? st.afternoonStopId;
    const vanId = st.morningVanId ?? st.afternoonVanId;
    const stop = stopId ? stops.get(stopId) : undefined;
    const vanName = vanId ? vans.get(vanId)?.name ?? null : null;

    // Mode-aware: a kid who needs a van leg but has no van resolved is unrouted.
    const unrouted = needsRouting({
      mode: st.mode,
      morningVanId: st.morningVanId,
      afternoonVanId: st.afternoonVanId,
      attending: st.attending,
    });

    let vanAndStop: string;
    if (unrouted) {
      vanAndStop = stop ? `⚠ NEEDS ROUTING · ${stop.name}` : "⚠ NEEDS ROUTING — no van";
    } else if (stopId == null) {
      vanAndStop = "Parent drop-off";
    } else if (vanName) {
      vanAndStop = stop ? `${vanName} · ${stop.name}` : vanName;
    } else {
      vanAndStop = stop ? `(no van) · ${stop.name}` : "(no van)";
    }

    entries.push({
      studentId: st.studentId,
      name: `${first} ${last}`,
      lastName: last,
      wristbandCode: stu.wristbandCode,
      age: ageFor(stu, eventDate),
      vanAndStop,
      guardianName: fam?.guardianName ?? "",
      guardianPhone: fam?.guardianPhone ?? "",
      emergencyName: fam?.emergencyName ?? null,
      emergencyPhone: fam?.emergencyPhone ?? null,
      allergies: stu.allergies,
      medicalNotes: stu.medicalNotes,
      needsRouting: unrouted,
    });
  }

  return entries.sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name),
  );
}
