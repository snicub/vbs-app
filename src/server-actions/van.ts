"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";

const LocationSchema = z.object({
  vanId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10000).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().min(0).max(100).optional(),
});

export async function broadcastVanLocation(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const parsed = LocationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid location payload" };
  }

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Verify the user is assigned to this van today (RLS would also block this).
  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id")
    .eq("assignment_date", today)
    .eq("van_id", parsed.data.vanId)
    .or(`driver_user_id.eq.${user.id},aide_user_id.eq.${user.id}`)
    .maybeSingle();
  if (!assignment && user.role !== "coordinator" && user.role !== "admin") {
    return { ok: false, error: "Not assigned to this van today" };
  }

  const { error } = await supabase.from("van_locations").upsert(
    {
      van_id: parsed.data.vanId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      accuracy_m: parsed.data.accuracyM ?? null,
      heading_deg: parsed.data.headingDeg ?? null,
      speed_mps: parsed.data.speedMps ?? null,
      reported_at: new Date().toISOString(),
      reported_by_user_id: user.id,
    } as never,
    { onConflict: "van_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator");
  return { ok: true };
}

/**
 * Resolve the van the current user is assigned to today (if any).
 */
export async function findMyVanForToday(): Promise<
  | { ok: true; vanId: string | null }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("van_assignments")
    .select("van_id")
    .eq("assignment_date", today)
    .or(`driver_user_id.eq.${user.id},aide_user_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle<{ van_id: string }>();

  if (error) return { ok: false, error: error.message };
  return { ok: true, vanId: data?.van_id ?? null };
}
