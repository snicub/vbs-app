"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";

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

  const { data, error } = await supabase.rpc("smart_checkout", {
    p_student_id: parsed.data.studentId,
    p_event_date: parsed.data.eventDate,
    p_actor_user_id: user.id,
    p_actor_role: user.role,
    p_pm_path: parsed.data.pmPath ?? "auto",
    p_pickup_metadata: pickupMetadata,
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
