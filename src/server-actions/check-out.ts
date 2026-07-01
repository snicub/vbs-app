"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { clampOccurredAt } from "@/lib/events/occurred-at";

const PickupMetadataSchema = z.object({
  authorizedPickupPersonId: z.string().uuid().nullable(),
  name: z.string().trim().min(1),
  relationship: z.string().trim().nullable().optional(),
  isEmergencyContact: z.boolean().optional(),
  wasUnlisted: z.boolean().optional(),
  notes: z.string().trim().nullable().optional(),
});

export type PickupMetadata = z.infer<typeof PickupMetadataSchema>;

const Schema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 'parent' = parent is here picking up now (force parent_pickup),
  // 'van'    = explicitly send via van,
  // 'auto'   = pick from the kid's transport mode for the day.
  pmPath: z.enum(["auto", "parent", "van"]).optional(),
  // Required when the resolved chain ends in parent_pickup. The volunteer
  // picks which authorized person is here (or types in an unlisted name
  // which is logged as wasUnlisted=true for the coordinator to review).
  pickup: PickupMetadataSchema.optional(),
  // Client capture time so an offline checkout records the real drop-off time,
  // not the later sync time.
  occurredAt: z.string().datetime().optional(),
});

/**
 * Smart "check out" — calls the public.smart_checkout() Postgres function
 * which chains site_checked_out → (van_boarded_pm + van_offloaded_pm) for
 * van mode, or site_checked_out → parent_pickup for parent mode. The
 * whole chain runs in a single transaction under one advisory lock — no
 * partial-failure ambiguity.
 *
 * When the chain ends in parent_pickup, the metadata on that event records
 * WHO picked up — either a row from authorized_pickup_persons, the family's
 * emergency contact, or an unlisted person (flagged for coordinator review).
 */
export async function smartCheckOut(
  input: unknown,
): Promise<{ ok: true; finalState: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  // Hard safety block: never release a child to a pickup person marked
  // "do not release to". Covers both the on-file picker (by id) and a free-form
  // typed name. smart_checkout() backstops this at the DB for direct RPC calls.
  if (parsed.data.pickup) {
    const guard = createAdminClient();
    const { data: stu } = await guard
      .from("students")
      .select("family_id")
      .eq("id", parsed.data.studentId)
      .maybeSingle<{ family_id: string }>();
    if (stu?.family_id) {
      const { data: restricted } = await guard
        .from("authorized_pickup_persons")
        .select("id, full_name")
        .eq("family_id", stu.family_id)
        .eq("is_restricted", true)
        .returns<{ id: string; full_name: string }[]>();
      const list = restricted ?? [];
      const pickedId = parsed.data.pickup.authorizedPickupPersonId;
      const pickedName = parsed.data.pickup.name.trim().toLowerCase();
      const barred =
        (pickedId != null && list.some((r) => r.id === pickedId)) ||
        list.some((r) => r.full_name.trim().toLowerCase() === pickedName);
      if (barred) {
        return {
          ok: false,
          error: "This person is marked DO NOT RELEASE TO — get a coordinator.",
        };
      }
    }
  }

  const supabase = user.role === "parent"
    ? await createClient()
    : createAdminClient();

  // Build the jsonb pickup metadata to stamp on the parent_pickup event.
  // Convert camelCase → snake_case so the Postgres function and downstream
  // queries see a consistent shape.
  const pickupMetadata = parsed.data.pickup
    ? {
        authorized_pickup_person_id: parsed.data.pickup.authorizedPickupPersonId,
        name: parsed.data.pickup.name,
        relationship: parsed.data.pickup.relationship ?? null,
        is_emergency_contact: parsed.data.pickup.isEmergencyContact ?? false,
        was_unlisted: parsed.data.pickup.wasUnlisted ?? false,
        notes: parsed.data.pickup.notes ?? null,
      }
    : {};

  // Drop a future client timestamp (see clampOccurredAt); smart_checkout
  // defaults a null to now().
  const occurredAt = clampOccurredAt(parsed.data.occurredAt, Date.now()) ?? null;

  const { data, error } = await supabase.rpc("smart_checkout", {
    p_student_id: parsed.data.studentId,
    p_event_date: parsed.data.eventDate,
    p_actor_user_id: user.id,
    p_actor_role: user.role,
    p_pm_path: parsed.data.pmPath ?? "auto",
    p_pickup_metadata: pickupMetadata,
    p_occurred_at: occurredAt,
  } as never);

  if (error) {
    return { ok: false, error: error.message };
  }

  type Row = { final_state: string; events_recorded: number };
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) return { ok: false, error: "smart_checkout returned no row" };

  // If the pickup was unlisted, flag an incident for coordinator review.
  // Only meaningful when this chain actually ended with parent_pickup —
  // i.e. the volunteer chose the "parent here" button (pmPath="parent").
  // For pmPath="van" the pickup payload is ignored by smart_checkout.
  if (parsed.data.pickup?.wasUnlisted && parsed.data.pmPath === "parent") {
    const admin = createAdminClient();
    await admin.from("incidents").insert({
      severity: "warning",
      category: "unlisted_pickup",
      summary: `Unlisted pickup person: ${parsed.data.pickup.name}`,
      details: {
        student_id: parsed.data.studentId,
        event_date: parsed.data.eventDate,
        pickup_name: parsed.data.pickup.name,
        pickup_relationship: parsed.data.pickup.relationship ?? null,
        notes: parsed.data.pickup.notes ?? null,
      },
      student_id: parsed.data.studentId,
      reported_by_user_id: user.id,
    } as never);
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, finalState: row.final_state };
}

// -- Bulk "send home": mark many kids home at once from the coordinator roster --

const BulkSendHomeSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1).max(200),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Coordinator-only: mark several students home in one action. Each runs through
 * smartCheckOut with pmPath 'auto' so a van kid goes home on their van chain and
 * a parent kid records a parent pickup (attributed to the family's primary
 * guardian). Kids who aren't in a releasable state are skipped, not failed —
 * the count reports how many were sent home vs skipped.
 */
export async function bulkSendHome(input: unknown): Promise<
  { ok: true; home: number; skipped: number } | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = BulkSendHomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };
  const { studentIds, eventDate } = parsed.data;

  const admin = createAdminClient();
  const { data: students } = await admin
    .from("students")
    .select("id, family_id")
    .in("id", studentIds)
    .returns<{ id: string; family_id: string }[]>();
  const familyIds = Array.from(new Set((students ?? []).map((s) => s.family_id)));
  const { data: families } = familyIds.length
    ? await admin
        .from("families")
        .select("id, primary_guardian_name")
        .in("id", familyIds)
        .returns<{ id: string; primary_guardian_name: string | null }[]>()
    : { data: [] as { id: string; primary_guardian_name: string | null }[] };
  const guardianByFamily = new Map((families ?? []).map((f) => [f.id, f.primary_guardian_name]));
  const guardianByStudent = new Map(
    (students ?? []).map((s) => [s.id, guardianByFamily.get(s.family_id) ?? null]),
  );

  let home = 0;
  let skipped = 0;
  for (const studentId of studentIds) {
    const name = (guardianByStudent.get(studentId) || "Parent").trim() || "Parent";
    const res = await smartCheckOut({
      studentId,
      eventDate,
      pmPath: "auto",
      pickup: {
        authorizedPickupPersonId: null,
        name,
        relationship: "Primary guardian",
        isEmergencyContact: false,
        wasUnlisted: false,
        notes: "Bulk marked home",
      },
    });
    if (res.ok) home++;
    else skipped++;
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true, home, skipped };
}
