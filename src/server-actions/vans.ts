"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { routeStopConflicts, sameDriverAndAide } from "@/lib/vans";

type Result = { ok: true } | { ok: false; error: string };

async function requireCoordinator(): Promise<boolean> {
  const user = await getSessionUser();
  return !!user && isCoordinator(user.role);
}

function fail(message: string): Result {
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

// -- Create a van --

const CreateVanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  capacity: z.number().int("Capacity must be a whole number").min(1, "Capacity must be at least 1").max(99),
  plate: z.string().trim().max(20).optional(),
});

export async function createVan(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = CreateVanSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.from("vans").insert({
    name: parsed.data.name,
    capacity: parsed.data.capacity,
    plate: parsed.data.plate || null,
  } as never);
  if (error) return fail(error.message);

  revalidateVanTrees();
  return { ok: true };
}

// -- Edit a van (name / capacity / plate / active) --

const UpdateVanSchema = z.object({
  vanId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(40).optional(),
  capacity: z.number().int("Capacity must be a whole number").min(1, "Capacity must be at least 1").max(99).optional(),
  plate: z.string().trim().max(20).nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateVan(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = UpdateVanSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const { vanId, ...fields } = parsed.data;
  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.capacity !== undefined) updates.capacity = fields.capacity;
  if (fields.plate !== undefined) updates.plate = fields.plate || null;
  if (fields.active !== undefined) updates.active = fields.active;
  if (Object.keys(updates).length === 0) return { ok: true };

  const supabase = await createClient();

  // Don't retire a van while it still routes kids — the status view would keep
  // mapping children onto it, but the route editor hides inactive vans, so
  // those stop assignments would silently become invisible.
  if (fields.active === false) {
    const { data: vanRoutes } = await supabase
      .from("routes")
      .select("stop_ids")
      .eq("van_id", vanId)
      .returns<{ stop_ids: string[] }[]>();
    if ((vanRoutes ?? []).some((r) => r.stop_ids.length > 0)) {
      return fail("Clear this van's routes before deactivating — kids are still assigned to it.");
    }
  }

  const { error } = await supabase.from("vans").update(updates as never).eq("id", vanId);
  if (error) return fail(error.message);

  revalidateVanTrees();
  return { ok: true };
}

// -- Set which stops a van serves (both directions, atomically) --

const SetRoutesSchema = z.object({
  vanId: z.string().uuid(),
  amStopIds: z.array(z.string().uuid()),
  pmStopIds: z.array(z.string().uuid()),
});

export async function setVanRoutes(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = SetRoutesSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const { vanId, amStopIds, pmStopIds } = parsed.data;
  const supabase = await createClient();

  // A stop may sit on at most one van per direction; otherwise the status view
  // places the child on two vans at once (two manifests, doubled counts).
  const { data: others, error: othersErr } = await supabase
    .from("routes")
    .select("van_id, direction, stop_ids")
    .neq("van_id", vanId)
    .returns<{ van_id: string; direction: "am" | "pm"; stop_ids: string[] }[]>();
  if (othersErr) return fail(othersErr.message);

  const conflicts = routeStopConflicts({ am: amStopIds, pm: pmStopIds }, others ?? []);
  if (conflicts.length > 0) {
    const stopIds = Array.from(new Set(conflicts.map((c) => c.stopId)));
    const vanIds = Array.from(new Set(conflicts.map((c) => c.vanId)));
    const [{ data: cStops }, { data: cVans }] = await Promise.all([
      supabase.from("stops").select("id, town").in("id", stopIds).returns<{ id: string; town: string }[]>(),
      supabase.from("vans").select("id, name").in("id", vanIds).returns<{ id: string; name: string }[]>(),
    ]);
    const townOf = new Map((cStops ?? []).map((s) => [s.id, s.town]));
    const nameOf = new Map((cVans ?? []).map((v) => [v.id, v.name]));
    const detail = conflicts
      .map(
        (c) =>
          `${townOf.get(c.stopId) ?? "A stop"} is already on ${nameOf.get(c.vanId) ?? "another van"}'s ${
            c.direction === "am" ? "morning" : "afternoon"
          } route`,
      )
      .join("; ");
    return fail(`${detail}. Remove it there first.`);
  }

  const { error } = await supabase.from("routes").upsert(
    [
      { van_id: vanId, direction: "am", stop_ids: amStopIds },
      { van_id: vanId, direction: "pm", stop_ids: pmStopIds },
    ] as never,
    { onConflict: "van_id,direction" },
  );
  if (error) return fail(error.message);

  revalidateVanTrees();
  return { ok: true };
}

// -- Set a van's driver + aide for a given day --

const SetAssignmentSchema = z
  .object({
    vanId: z.string().uuid(),
    assignmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    driverUserId: z.string().uuid().nullable(),
    aideUserId: z.string().uuid().nullable(),
  })
  .refine((d) => !sameDriverAndAide(d.driverUserId, d.aideUserId), {
    message: "Driver and aide must be different people",
    path: ["aideUserId"],
  });

export async function setVanAssignment(input: unknown): Promise<Result> {
  if (!(await requireCoordinator())) return fail("Coordinator access required");

  const parsed = SetAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail(issues(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.from("van_assignments").upsert(
    {
      assignment_date: parsed.data.assignmentDate,
      van_id: parsed.data.vanId,
      driver_user_id: parsed.data.driverUserId,
      aide_user_id: parsed.data.aideUserId,
    } as never,
    { onConflict: "assignment_date,van_id" },
  );
  if (error) return fail(error.message);

  revalidateVanTrees();
  return { ok: true };
}
