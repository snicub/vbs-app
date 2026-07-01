"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import {
  sameDriverAndAide,
  zoneStopIdForVan,
  findVansMissingZone,
  buildZoneStopInsert,
  type DirectionRoute,
} from "@/lib/vans";
import { isValidHexColor } from "@/lib/validators";
import { geocodeAddress } from "@/lib/geocode";

type Result = { ok: true } | { ok: false; error: string };

/** Default band color for a new van's pickup zone (a calm teal). */
const DEFAULT_ZONE_COLOR = "#0F766E";

async function requireCoordinator(): Promise<boolean> {
  const user = await getSessionUser();
  return !!user && isCoordinator(user.role);
}

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

function issues(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

/** Colors/routes/assignments all show up under these trees; refresh broadly. */
function revalidateVanTrees(): void {
  revalidatePath("/coordinator", "layout");
  revalidatePath("/van", "layout");
}

// -- Create a van (+ its pickup zone) --

const CreateVanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  capacity: z.number().int("Capacity must be a whole number").min(1, "Capacity must be at least 1").max(99),
  plate: z.string().trim().max(20).optional(),
  colorCode: z.string().trim().refine(isValidHexColor, "Pick a color"),
});

export async function createVan(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = CreateVanSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));
  const { name, capacity, plate, colorCode } = parsed.data;

  const supabase = createAdminClient();

  const { data: van, error: vanErr } = await supabase
    .from("vans")
    .insert({ name, capacity, plate: plate || null } as never)
    .select("id")
    .single<{ id: string }>();
  if (vanErr || !van) return fail(vanErr?.message ?? "Could not create the van");

  // Each van owns one pickup zone: a stop carrying the van's color, sitting on
  // both of the van's routes. The status view derives a kid's van + color from
  // this. If any step fails, roll the van back so we never leave a van with no
  // zone (kids could never ride it).
  const zone = await provisionVanZone(supabase, { vanName: name, colorCode });
  if (!zone.ok) {
    await supabase.from("vans").delete().eq("id", van.id);
    return fail(zone.error);
  }

  const routed = await setVanRouteStops(supabase, van.id, zone.stopId);
  if (!routed.ok) {
    await supabase.from("vans").delete().eq("id", van.id); // cascade drops any routes
    await supabase.from("stops").delete().eq("id", zone.stopId);
    return fail(routed.error);
  }

  revalidateVanTrees();
  return { ok: true };
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Insert the van's pickup-zone stop. Returns the new stop id on success. */
async function provisionVanZone(
  supabase: SupabaseClient,
  z: { vanName: string; colorCode: string },
): Promise<{ ok: true; stopId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("stops")
    .insert(buildZoneStopInsert({ vanName: z.vanName, colorCode: z.colorCode }) as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the van's pickup zone" };
  return { ok: true, stopId: data.id };
}

/** Point both of a van's routes at its single zone stop. */
async function setVanRouteStops(
  supabase: SupabaseClient,
  vanId: string,
  stopId: string,
): Promise<Result> {
  const { error } = await supabase.from("routes").upsert(
    [
      { van_id: vanId, direction: "am", stop_ids: [stopId] },
      { van_id: vanId, direction: "pm", stop_ids: [stopId] },
    ] as never,
    { onConflict: "van_id,direction" },
  );
  if (error) return fail(error.message);
  return { ok: true };
}

// -- Edit a van (name / capacity / plate / active) --

const UpdateVanSchema = z.object({
  vanId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(40).optional(),
  capacity: z.number().int("Capacity must be a whole number").min(1, "Capacity must be at least 1").max(99).optional(),
  plate: z.string().trim().max(20).nullable().optional(),
  active: z.boolean().optional(),
  colorCode: z.string().trim().refine(isValidHexColor, "Pick a color").optional(),
  // A rough area address for this van (e.g. "North Sisseton, SD"). Geocoded to
  // coordinates on the zone stop so the address→van suggestion can match each
  // home to its nearest van. Empty string clears it.
  areaAddress: z.string().trim().nullable().optional(),
});

export async function updateVan(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = UpdateVanSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const { vanId, ...fields } = parsed.data;
  const vanUpdates: Record<string, unknown> = {};
  if (fields.name !== undefined) vanUpdates.name = fields.name;
  if (fields.capacity !== undefined) vanUpdates.capacity = fields.capacity;
  if (fields.plate !== undefined) vanUpdates.plate = fields.plate || null;
  if (fields.active !== undefined) vanUpdates.active = fields.active;

  // The van's name and color live on its pickup-zone stop — keep them in sync so
  // the kids' band color tracks edits.
  const zoneUpdates: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    zoneUpdates.name = fields.name;
    zoneUpdates.town = fields.name;
    zoneUpdates.color_name = fields.name;
  }
  if (fields.colorCode !== undefined) zoneUpdates.color_code = fields.colorCode;

  // Area location → coordinates on the zone stop (powers the address→van
  // suggestion). Empty clears it (the van drops out of suggestion, manual still
  // works); a value that won't geocode is rejected so we never store an area
  // with no coordinates that would silently never match a home.
  if (fields.areaAddress !== undefined) {
    const addr = fields.areaAddress?.trim() ?? "";
    if (addr === "") {
      zoneUpdates.street_address = null;
      zoneUpdates.lat = null;
      zoneUpdates.lng = null;
    } else {
      const pt = await geocodeAddress(addr);
      if (!pt) return fail("Couldn't find that area location — check the address and try again.");
      zoneUpdates.street_address = addr;
      zoneUpdates.lat = pt.lat;
      zoneUpdates.lng = pt.lng;
    }
  }

  if (Object.keys(vanUpdates).length === 0 && Object.keys(zoneUpdates).length === 0) {
    return { ok: true };
  }

  const supabase = createAdminClient();

  // Don't retire a van while kids are still assigned to it — the status view
  // would keep mapping them onto its pickup zone, stranding them on an inactive
  // van. Check the ACTUAL rider count on the zone (door-to-door: a van's routes
  // ALWAYS hold its zone stop, so the old "any route has stops" check made every
  // van impossible to deactivate). Mirrors deleteVan's guard.
  if (fields.active === false) {
    const { data: routes } = await supabase
      .from("routes")
      .select("van_id, direction, stop_ids")
      .eq("van_id", vanId)
      .returns<DirectionRoute[]>();
    const zoneStopId = zoneStopIdForVan(vanId, routes ?? []);
    if (zoneStopId) {
      const { count } = await supabase
        .from("student_day_records")
        .select("id", { count: "exact", head: true })
        .or(`morning_stop_id.eq.${zoneStopId},afternoon_stop_id.eq.${zoneStopId}`);
      if ((count ?? 0) > 0) {
        return fail("Reassign this van's riders before deactivating it.");
      }
    }
  }

  if (Object.keys(vanUpdates).length > 0) {
    const { error } = await supabase.from("vans").update(vanUpdates as never).eq("id", vanId);
    if (error) return fail(error.message);
  }

  if (Object.keys(zoneUpdates).length > 0) {
    const { data: routes } = await supabase
      .from("routes")
      .select("van_id, direction, stop_ids")
      .eq("van_id", vanId)
      .returns<DirectionRoute[]>();
    const zoneStopId = zoneStopIdForVan(vanId, routes ?? []);
    if (zoneStopId) {
      const { error } = await supabase.from("stops").update(zoneUpdates as never).eq("id", zoneStopId);
      if (error) return fail(error.message);
    }
  }

  revalidateVanTrees();
  return { ok: true };
}

// -- Delete a van (+ its pickup zone) --

const DeleteVanSchema = z.object({
  vanId: z.string().uuid(),
  // Set when the coordinator has confirmed (in the dialog showing the count) that
  // deleting this van should also unassign the kids planned onto it.
  unassignRiders: z.boolean().optional(),
});

/**
 * Coordinator-only: permanently remove a van, its routes, last-known location,
 * and its pickup-zone stop. Used to clean up a test van.
 *
 * Refuses if the van appears on ANY append-only event row: deleting the van would
 * force `student_day_events.van_id` → NULL (FK ON DELETE SET NULL), which the
 * append-only trigger rejects — aborting AFTER van_assignments were already
 * deleted (partial loss). A van that's ever carried a kid keeps its history; only
 * an unused (test) van is deletable.
 *
 * If kids are merely PLANNED onto it (stop legs point at its zone, but it has no
 * event history so none were ever boarded), the caller must pass
 * `unassignRiders: true` — we then clear those legs (the kids become "needs
 * routing" until put on another van) and delete. Without the flag we refuse, so
 * a stray call can't silently strip a child's routing.
 *
 * Runs via the admin client (RLS-free) after the coordinator check, and respects
 * the FK rules: `van_assignments` is ON DELETE RESTRICT so it's cleared first;
 * deleting the van then cascades its `routes` and `van_locations`; finally the
 * now-orphaned zone stop is removed.
 */
export async function deleteVan(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = DeleteVanSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));
  const { vanId, unassignRiders } = parsed.data;

  const admin = createAdminClient();

  // Fail CLOSED: if we can't read the van's routes (hence resolve its pickup
  // zone), we cannot prove its rider state — so we must NOT delete. A transient
  // error must never let the delete proceed.
  const { data: routes, error: routesErr } = await admin
    .from("routes")
    .select("van_id, direction, stop_ids")
    .eq("van_id", vanId)
    .returns<DirectionRoute[]>();
  if (routesErr) return fail(`Couldn't check this van's riders — try again. (${routesErr.message})`);
  const zoneStopId = zoneStopIdForVan(vanId, routes ?? []);

  // Fail CLOSED first: a van on ANY event row can't be deleted — the delete would
  // SET NULL on student_day_events.van_id, which the append-only trigger rejects.
  // Only an unused (never-boarded) van is deletable; a used one keeps its history.
  // Checking this BEFORE touching day-records also means a refused delete never
  // unassigns anyone.
  const { count: eventCount, error: eventErr } = await admin
    .from("student_day_events")
    .select("id", { count: "exact", head: true })
    .eq("van_id", vanId);
  if (eventErr) return fail(`Couldn't check this van's history — try again. (${eventErr.message})`);
  if ((eventCount ?? 0) > 0) {
    return fail(
      "This van has check-in history and can't be deleted. Mark it inactive instead (uncheck Active).",
    );
  }

  if (zoneStopId) {
    const { count, error: countErr } = await admin
      .from("student_day_records")
      .select("id", { count: "exact", head: true })
      .or(`morning_stop_id.eq.${zoneStopId},afternoon_stop_id.eq.${zoneStopId}`);
    if (countErr) return fail(`Couldn't check this van's riders — try again. (${countErr.message})`);

    if ((count ?? 0) > 0) {
      if (!unassignRiders) {
        return fail(
          `${count} kid${count === 1 ? " is" : "s are"} assigned to this van — confirm to unassign them and delete it.`,
        );
      }
      // Unassign: clear every stop leg pointing at this zone (across all days).
      // Safe because the event-history guard above proved no kid was ever boarded
      // on this van — these are plan-only assignments; the kids become "needs
      // routing" until a coordinator puts them on another van.
      const { error: amErr } = await admin
        .from("student_day_records")
        .update({ morning_stop_id: null } as never)
        .eq("morning_stop_id", zoneStopId);
      if (amErr) return fail(amErr.message);
      const { error: pmErr } = await admin
        .from("student_day_records")
        .update({ afternoon_stop_id: null } as never)
        .eq("afternoon_stop_id", zoneStopId);
      if (pmErr) return fail(pmErr.message);
    }
  }

  const { error: assignErr } = await admin
    .from("van_assignments")
    .delete()
    .eq("van_id", vanId);
  if (assignErr) return fail(assignErr.message);

  const { error: vanErr } = await admin.from("vans").delete().eq("id", vanId);
  if (vanErr) return fail(vanErr.message);

  if (zoneStopId) {
    await admin.from("stops").delete().eq("id", zoneStopId);
  }

  revalidateVanTrees();
  return { ok: true };
}

// -- Backfill pickup zones for vans created before the door-to-door model --

type EnsureResult = { ok: true; provisioned: number } | { ok: false; error: string };

/**
 * Give every van that has no pickup zone one (a stop on both its routes), so
 * existing test vans can carry kids under the door-to-door model. Idempotent:
 * vans that already have a zone are left untouched. Backfilled zones get a
 * default color the coordinator can then change.
 */
export async function ensureVanZones(): Promise<EnsureResult> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const supabase = createAdminClient();
  const [{ data: vans, error: vansErr }, { data: routes, error: routesErr }] = await Promise.all([
    supabase.from("vans").select("id, name").returns<{ id: string; name: string }[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<DirectionRoute[]>(),
  ]);
  if (vansErr) return fail(vansErr.message);
  if (routesErr) return fail(routesErr.message);

  const missing = findVansMissingZone(vans ?? [], routes ?? []);
  if (missing.length === 0) return { ok: true, provisioned: 0 };

  const byId = new Map((vans ?? []).map((v) => [v.id, v.name]));
  for (const v of missing) {
    const vanName = byId.get(v.id) ?? "Van";
    const zone = await provisionVanZone(supabase, {
      vanName,
      colorCode: DEFAULT_ZONE_COLOR,
    });
    if (!zone.ok) return fail(zone.error);
    const routed = await setVanRouteStops(supabase, v.id, zone.stopId);
    if (!routed.ok) {
      await supabase.from("stops").delete().eq("id", zone.stopId);
      return fail(routed.error);
    }
  }

  revalidateVanTrees();
  return { ok: true, provisioned: missing.length };
}

// -- Set a van's driver + aide for a given day --

const NameField = z
  .string()
  // Allows several comma-separated names for a region run by multiple crews.
  .max(200, "Too long")
  .nullable()
  .transform((v) => {
    const trimmed = v?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  });

const SetAssignmentSchema = z
  .object({
    vanId: z.string().uuid(),
    assignmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    driverName: NameField,
    aideName: NameField,
  })
  .refine((d) => !sameDriverAndAide(d.driverName, d.aideName), {
    message: "Driver and aide must be different people",
    path: ["aideName"],
  });

export async function setVanAssignment(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = SetAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const supabase = createAdminClient();
  const { error } = await supabase.from("van_assignments").upsert(
    {
      assignment_date: parsed.data.assignmentDate,
      van_id: parsed.data.vanId,
      driver_name: parsed.data.driverName,
      aide_name: parsed.data.aideName,
    } as never,
    { onConflict: "assignment_date,van_id" },
  );
  if (error) return fail(error.message);

  revalidateVanTrees();
  return { ok: true };
}
