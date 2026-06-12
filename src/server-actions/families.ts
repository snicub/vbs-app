"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/registration/schema";

const FamilyIdSchema = z.object({ familyId: z.string().uuid() });

/**
 * Returns the family's current active parent-status URL (unrevoked,
 * unexpired). If no active token exists, returns null — the coordinator
 * can rotate to create one.
 */
export async function getFamilyAccessUrl(
  input: unknown,
): Promise<
  | { ok: true; url: string | null }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = FamilyIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("family_access_tokens")
    .select("token")
    .eq("family_id", parsed.data.familyId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ token: string }>();
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    url: data ? `${env.NEXT_PUBLIC_BASE_URL}/parent/${data.token}` : null,
  };
}

/**
 * Revoke every active token for the family and issue a fresh one. Used
 * when a parent's phone is stolen, when the family changes hands, or when
 * a screenshotted link has leaked. Coordinator-only.
 */
export async function rotateFamilyToken(
  input: unknown,
): Promise<
  | { ok: true; url: string }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }
  const parsed = FamilyIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const admin = createAdminClient();

  const { error: revokeErr } = await admin
    .from("family_access_tokens")
    .update({ revoked_at: new Date().toISOString() } as never)
    .eq("family_id", parsed.data.familyId)
    .is("revoked_at", null);
  if (revokeErr) return { ok: false, error: revokeErr.message };

  const { data: fresh, error: insertErr } = await admin
    .from("family_access_tokens")
    .insert({ family_id: parsed.data.familyId } as never)
    .select("token")
    .single<{ token: string }>();
  if (insertErr || !fresh) {
    return { ok: false, error: insertErr?.message ?? "could not issue new token" };
  }

  revalidatePath("/table", "layout");
  revalidatePath("/coordinator", "layout");

  return { ok: true, url: `${env.NEXT_PUBLIC_BASE_URL}/parent/${fresh.token}` };
}

// -- Update family contacts --

const UpdateFamilyContactsSchema = z.object({
  familyId: z.string().uuid(),
  primaryPhone: z.string().trim().min(1, "Phone is required").transform(normalizePhone).optional(),
  emergencyContactName: z.string().trim().optional(),
  emergencyContactPhone: z.string().trim().transform(normalizePhone).optional(),
  emergencyContactRelationship: z.string().trim().optional(),
});

export type UpdateFamilyContactsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: update a family's contact info. The most common day-of
 * correction is "parent changed their phone number" or "wrong emergency
 * contact." Only changed fields need to be sent.
 */
export async function updateFamilyContacts(
  input: unknown,
): Promise<UpdateFamilyContactsResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateFamilyContactsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { familyId, ...fields } = parsed.data;

  const updates: Record<string, string | null> = {};
  if (fields.primaryPhone !== undefined) {
    updates.primary_phone = fields.primaryPhone;
  }
  if (fields.emergencyContactName !== undefined) {
    updates.emergency_contact_name = fields.emergencyContactName || null;
  }
  if (fields.emergencyContactPhone !== undefined) {
    updates.emergency_contact_phone = fields.emergencyContactPhone || null;
  }
  if (fields.emergencyContactRelationship !== undefined) {
    updates.emergency_contact_relationship = fields.emergencyContactRelationship || null;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("families")
    .update(updates as never)
    .eq("id", familyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  return { ok: true };
}

// -- Update guardian phone --

const UpdateGuardianPhoneSchema = z.object({
  guardianId: z.string().uuid(),
  phone: z.string().trim().min(1, "Phone is required").transform(normalizePhone),
});

export type UpdateGuardianPhoneResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Coordinator-only: update a guardian's phone number. Used when a parent
 * says "call me at a different number today."
 */
export async function updateGuardianPhone(
  input: unknown,
): Promise<UpdateGuardianPhoneResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateGuardianPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("guardians")
    .update({ phone: parsed.data.phone } as never)
    .eq("id", parsed.data.guardianId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  return { ok: true };
}
