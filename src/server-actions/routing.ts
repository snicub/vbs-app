"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { geocodeFamilyAddress, familyAddressQuery, localRegionKey } from "@/lib/geocode";
import { type StopPoint } from "@/lib/route-build";
import { ridesMorningVan, ridesAfternoonVan } from "@/lib/routing";
import { VBS_DATES } from "@/lib/registration/dates";

const Schema = z.object({ eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// Cap geocoding per run so a click can't exceed the serverless timeout. Mapbox
// is fast, so this is generous; any remainder is reported and a second click
// finishes them.
const GEOCODE_CAP = 75;
const GEOCODE_BATCH = 8;

type Family = {
  id: string;
  lat: number | null;
  lng: number | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};
type Rec = {
  student_id: string;
  event_date: string;
  mode: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  attending: boolean;
  students: { family_id: string; families: Family | null } | null;
};

export type RouteBuildResult =
  | { ok: true; geocoded: number; assigned: number; flagged: number; pending: number }
  | { ok: false; error: string };

/**
 * Coordinator action: turn collected home addresses into VAN assignments under
 * the door-to-door model. Each van has one pickup "zone" stop on its route that
 * carries the van's area coordinates; assigning a kid to the nearest zone == the
 * nearest van. Geocodes families that don't have coordinates yet, then points
 * each un-routed van kid's empty legs at their nearest van's zone (a full-van
 * kid lands on ONE van — both legs the same zone — and a coordinator's manual
 * choice is never overridden). Candidate zones are ONLY stops on a van route
 * with coordinates, so a kid is never pointed at a stop that derives no van.
 * Kids with no address (or a failed geocode) are counted as "flagged" so the
 * coordinator handles them by hand — they're never silently put on a van.
 */
export async function autoAssignStopsFromAddresses(
  input: unknown,
): Promise<RouteBuildResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const admin = createAdminClient();

  // Candidate zones = stops that sit on a van route. A stop not on any route
  // derives no van, so pointing a kid at it would silently un-route them.
  const { data: routesData } = await admin
    .from("routes")
    .select("stop_ids")
    .returns<{ stop_ids: string[] }[]>();
  const routedStopIds = new Set<string>();
  for (const r of routesData ?? []) for (const id of r.stop_ids) routedStopIds.add(id);
  if (routedStopIds.size === 0) {
    return {
      ok: false,
      error: "No vans have routes yet — set up vans and their pickup zones first, or assign vans manually.",
    };
  }

  const { data: stopsData } = await admin
    .from("stops")
    .select("id, name, lat, lng")
    .returns<{ id: string; name: string; lat: number | null; lng: number | null }[]>();
  const stops: StopPoint[] = (stopsData ?? [])
    .filter(
      (s): s is { id: string; name: string; lat: number; lng: number } =>
        s.lat != null && s.lng != null && routedStopIds.has(s.id),
    )
    .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }));

  // Map each region key → that region's routed zone stop, BY NAME (the zone stop
  // is named after the region). This is what makes routing exact: a Barker Hill
  // address goes to the stop literally named "Barker Hill", never to whatever zone
  // is geographically nearest a hardcoded center.
  const REGION_KEYS = ["barker", "hollow", "agency", "peever", "sisseton"] as const;
  const zoneStopIdByKey = new Map<string, string>();
  for (const s of stopsData ?? []) {
    if (!routedStopIds.has(s.id)) continue;
    const lower = s.name.toLowerCase();
    for (const key of REGION_KEYS) if (lower.includes(key)) zoneStopIdByKey.set(key, s.id);
  }
  if (stops.length === 0) {
    return {
      ok: false,
      error: "No van has an area location yet — set each van's pickup-zone location first, or assign vans manually.",
    };
  }

  // Route the WHOLE event in one pass: addresses (hence stops) are the same
  // every day, so a kid routed for Day 1 must be routed for Days 2–5 too. We
  // pull every VBS day's records, geocode each family once (shared across days),
  // then assign stops per (student, day).
  const { data: recs } = await admin
    .from("student_day_records")
    .select(
      "student_id, event_date, mode, morning_stop_id, afternoon_stop_id, attending, students(family_id, families(id, lat, lng, street_address, city, state, postal_code))",
    )
    .in("event_date", [...VBS_DATES])
    .eq("attending", true)
    .returns<Rec[]>();

  // Collect families that need geocoding: a van-needing kid, an address on
  // file, but no coordinates yet. Dedupe by family (siblings share one).
  const needGeocode = new Map<string, Family>();
  for (const r of recs ?? []) {
    if (!r.mode || r.mode === "parent_both") continue;
    const fam = r.students?.families;
    if (!fam || (fam.lat != null && fam.lng != null)) continue;
    if (!familyAddressQuery(toAddr(fam))) continue;
    if (!needGeocode.has(fam.id)) needGeocode.set(fam.id, fam);
  }

  const geocoded = new Map<string, { lat: number; lng: number }>();
  const families = Array.from(needGeocode.values()).slice(0, GEOCODE_CAP);
  const pending = needGeocode.size - families.length;
  for (let i = 0; i < families.length; i += GEOCODE_BATCH) {
    const batch = families.slice(i, i + GEOCODE_BATCH);
    const points = await Promise.all(
      batch.map(async (fam) => ({ id: fam.id, pt: await geocodeFamilyAddress(toAddr(fam)) })),
    );
    for (const { id, pt } of points) {
      if (!pt) {
        // Address was tried and didn't match — flag it so the map can say
        // "fix this address" instead of "tap Locate" forever.
        await admin
          .from("families")
          .update({ geocode_failed_at: new Date().toISOString() } as never)
          .eq("id", id);
        continue;
      }
      geocoded.set(id, pt);
      await admin
        .from("families")
        .update({ lat: pt.lat, lng: pt.lng, geocode_failed_at: null } as never)
        .eq("id", id);
    }
  }

  // Assign nearest stops to un-routed van kids that now have coordinates, across
  // every day. `assigned` counts day-slots filled; `flagged` is DISTINCT kids
  // with no usable address (deduped — a no-address kid recurs on every day).
  let assigned = 0;
  const flaggedStudents = new Set<string>();
  for (const r of recs ?? []) {
    if (!r.mode || r.mode === "parent_both") continue;
    const needsAm = ridesMorningVan(r.mode) && !r.morning_stop_id;
    const needsPm = ridesAfternoonVan(r.mode) && !r.afternoon_stop_id;
    if (!needsAm && !needsPm) continue; // already routed

    const fam = r.students?.families;
    // DETERMINISTIC, NEVER GUESS: only auto-assign when the TOWN (or street, as a
    // fallback) names one of our regions, then send the kid to the van LITERALLY
    // NAMED for that region. An address the geocoder placed but no region word
    // matches stays FLAGGED for the coordinator to place by hand — never routed
    // onto the nearest van. Same address → same region → same named van, always.
    const key = fam ? localRegionKey(toAddr(fam)) : null;
    const zoneStopId = key ? zoneStopIdByKey.get(key) : undefined;
    if (!zoneStopId) {
      flaggedStudents.add(r.student_id);
      continue;
    }
    const nextMorning = needsAm ? zoneStopId : r.morning_stop_id;
    const nextAfternoon = needsPm ? zoneStopId : r.afternoon_stop_id;
    if (nextMorning !== r.morning_stop_id || nextAfternoon !== r.afternoon_stop_id) {
      await admin
        .from("student_day_records")
        .update({
          morning_stop_id: nextMorning,
          afternoon_stop_id: nextAfternoon,
        } as never)
        .eq("student_id", r.student_id)
        .eq("event_date", r.event_date);
      assigned++;
    }
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, geocoded: geocoded.size, assigned, flagged: flaggedStudents.size, pending };
}

function toAddr(f: Family) {
  return {
    streetAddress: f.street_address,
    city: f.city,
    state: f.state,
    postalCode: f.postal_code,
  };
}

export type LocateHomesResult =
  | { ok: true; located: number; stillMissing: number }
  | { ok: false; error: string };

/**
 * Coordinator action: geocode home addresses ONLY (no van/stop assignment) so a
 * kid's home pin appears on the Pickup Map before any manual assignment. For the
 * given day's van-needing attending kids, geocode each family that has a street
 * address but no coordinates yet (capped per run like autoAssign), write lat/lng
 * back to `families`, and report how many landed vs. still missing (failed
 * geocode or no address at all — those stay flagged, never silently dropped).
 *
 * Coordinates are family-wide, so locating one sibling locates the whole family;
 * the count is by family, deduped.
 */
export async function locateStudentHomes(
  input: unknown,
): Promise<LocateHomesResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const admin = createAdminClient();

  const { data: recs } = await admin
    .from("student_day_records")
    .select(
      "student_id, event_date, mode, morning_stop_id, afternoon_stop_id, attending, students(family_id, families(id, lat, lng, street_address, city, state, postal_code))",
    )
    .eq("event_date", parsed.data.eventDate)
    .eq("attending", true)
    .returns<Rec[]>();

  // Families of van-needing kids that have an address but no coords yet.
  const needGeocode = new Map<string, Family>();
  for (const r of recs ?? []) {
    if (!r.mode || r.mode === "parent_both") continue;
    const fam = r.students?.families;
    if (!fam || (fam.lat != null && fam.lng != null)) continue;
    if (!familyAddressQuery(toAddr(fam))) continue;
    if (!needGeocode.has(fam.id)) needGeocode.set(fam.id, fam);
  }

  const families = Array.from(needGeocode.values()).slice(0, GEOCODE_CAP);
  let located = 0;
  for (let i = 0; i < families.length; i += GEOCODE_BATCH) {
    const batch = families.slice(i, i + GEOCODE_BATCH);
    const points = await Promise.all(
      batch.map(async (fam) => ({ id: fam.id, pt: await geocodeFamilyAddress(toAddr(fam)) })),
    );
    for (const { id, pt } of points) {
      if (!pt) {
        // Tried and didn't match — flag the address as bad (distinct from "not
        // located yet") so the coordinator knows to fix it, not re-Locate it.
        await admin
          .from("families")
          .update({ geocode_failed_at: new Date().toISOString() } as never)
          .eq("id", id);
        continue;
      }
      await admin
        .from("families")
        .update({ lat: pt.lat, lng: pt.lng, geocode_failed_at: null } as never)
        .eq("id", id);
      located++;
    }
  }

  revalidatePath("/coordinator", "layout");

  // stillMissing = families that wanted geocoding but didn't get coords (failed
  // or beyond the per-run cap). No-address kids are surfaced on the map's
  // "needs an address" list separately.
  const stillMissing = needGeocode.size - located;

  return { ok: true, located, stillMissing };
}

// -- Set / correct a student's home address inline from the Pickup Map --

const SetHomeAddressSchema = z.object({
  studentId: z.string().uuid(),
  streetAddress: z.string().trim().min(1, "Street address is required"),
  city: z.string().trim().min(1, "City / town is required"),
});

export type SetHomeAddressResult =
  | { ok: true; located: boolean }
  | { ok: false; error: string };

/**
 * Coordinator action: set/correct a student's home street + city inline from the
 * Pickup Map and geocode it immediately, so a wrong pin moves to the right spot
 * (or a missing home appears) without leaving the map. The address lives on the
 * FAMILY, so this updates every kid in that family. State is hard-set to "SD" to
 * match registration (the event is in Sisseton). On a successful geocode we write
 * the new coords and clear the failed flag; if it still doesn't match we clear the
 * coords and flag it so it surfaces under "Address didn't match".
 */
export async function setStudentHomeAddress(input: unknown): Promise<SetHomeAddressResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = SetHomeAddressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { studentId, streetAddress, city } = parsed.data;
  const admin = createAdminClient();

  const { data: student } = await admin
    .from("students")
    .select("family_id")
    .eq("id", studentId)
    .maybeSingle<{ family_id: string }>();
  if (!student) return { ok: false, error: "Student not found" };

  const pt = await geocodeFamilyAddress({ streetAddress, city, state: "SD", postalCode: null });

  const { error } = await admin
    .from("families")
    .update({
      street_address: streetAddress,
      city,
      state: "SD",
      lat: pt?.lat ?? null,
      lng: pt?.lng ?? null,
      geocode_failed_at: pt ? null : new Date().toISOString(),
    } as never)
    .eq("id", student.family_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  return { ok: true, located: !!pt };
}
