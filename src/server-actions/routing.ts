"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { geocodeAddress, familyAddressQuery } from "@/lib/geocode";
import { assignStopsForMode, type StopPoint } from "@/lib/route-build";
import { ridesMorningVan, ridesAfternoonVan } from "@/lib/routing";

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
 * Coordinator action: turn collected home addresses into van assignments.
 * Geocodes families that don't have coordinates yet, then assigns each
 * un-routed van kid to the stop nearest their home (only filling empty legs
 * their mode needs — never overriding a coordinator's manual choice). Kids with
 * no address (or a failed geocode) are counted as "flagged" so the coordinator
 * knows to handle them by hand — they're never silently put on a van.
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
  const date = parsed.data.eventDate;

  const admin = createAdminClient();

  const { data: stopsData } = await admin
    .from("stops")
    .select("id, lat, lng")
    .returns<{ id: string; lat: number | null; lng: number | null }[]>();
  const stops: StopPoint[] = (stopsData ?? [])
    .filter((s): s is { id: string; lat: number; lng: number } => s.lat != null && s.lng != null)
    .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }));
  if (stops.length === 0) {
    return { ok: false, error: "No stops have coordinates yet — add stops first." };
  }

  const { data: recs } = await admin
    .from("student_day_records")
    .select(
      "student_id, mode, morning_stop_id, afternoon_stop_id, attending, students(family_id, families(id, lat, lng, street_address, city, state, postal_code))",
    )
    .eq("event_date", date)
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
      batch.map(async (fam) => ({ id: fam.id, pt: await geocodeAddress(familyAddressQuery(toAddr(fam))) })),
    );
    for (const { id, pt } of points) {
      if (!pt) continue;
      geocoded.set(id, pt);
      await admin.from("families").update({ lat: pt.lat, lng: pt.lng } as never).eq("id", id);
    }
  }

  // Assign nearest stops to un-routed van kids that now have coordinates.
  let assigned = 0;
  let flagged = 0;
  for (const r of recs ?? []) {
    if (!r.mode || r.mode === "parent_both") continue;
    const needsAm = ridesMorningVan(r.mode) && !r.morning_stop_id;
    const needsPm = ridesAfternoonVan(r.mode) && !r.afternoon_stop_id;
    if (!needsAm && !needsPm) continue; // already routed

    const fam = r.students?.families;
    const point =
      fam && fam.lat != null && fam.lng != null
        ? { lat: fam.lat, lng: fam.lng }
        : (fam ? geocoded.get(fam.id) ?? null : null);
    if (!point) {
      flagged++; // no address or geocode failed — coordinator handles by hand
      continue;
    }

    const next = assignStopsForMode(point, stops, r.mode, {
      morningStopId: r.morning_stop_id,
      afternoonStopId: r.afternoon_stop_id,
    });
    if (
      next.morningStopId !== r.morning_stop_id ||
      next.afternoonStopId !== r.afternoon_stop_id
    ) {
      await admin
        .from("student_day_records")
        .update({
          morning_stop_id: next.morningStopId,
          afternoon_stop_id: next.afternoonStopId,
        } as never)
        .eq("student_id", r.student_id)
        .eq("event_date", date);
      assigned++;
    }
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, geocoded: geocoded.size, assigned, flagged, pending };
}

function toAddr(f: Family) {
  return {
    streetAddress: f.street_address,
    city: f.city,
    state: f.state,
    postalCode: f.postal_code,
  };
}
