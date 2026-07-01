"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { getLocalDate } from "@/lib/date";

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

  const supabase = createAdminClient();
  const today = getLocalDate();

  // Verify the user is assigned to this van today (RLS would also block this).
  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id")
    .eq("assignment_date", today)
    .eq("van_id", parsed.data.vanId)
    .or(`driver_user_id.eq.${user.id},aide_user_id.eq.${user.id}`)
    .maybeSingle();
  if (!assignment) {
    if (user.role !== "coordinator" && user.role !== "admin") {
      return { ok: false, error: "Not assigned to this van today" };
    }
    // Coordinator/admin overriding the assignment check — log once per
    // (actor, van, day) so a 9-hour broadcast doesn't write thousands of rows.
    const startOfDay = new Date(`${today}T00:00:00Z`).toISOString();
    const { count } = await supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("category", "van_gps_override")
      .eq("van_id", parsed.data.vanId)
      .eq("reported_by_user_id", user.id)
      .gte("occurred_at", startOfDay);
    if (!count || count === 0) {
      await supabase.from("incidents").insert({
        severity: "info",
        category: "van_gps_override",
        summary: `${user.role} broadcast GPS for van ${parsed.data.vanId} without an assignment`,
        details: {
          van_id: parsed.data.vanId,
          actor_user_id: user.id,
          actor_role: user.role,
        },
        van_id: parsed.data.vanId,
        reported_by_user_id: user.id,
      } as never);
    }
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

  return { ok: true };
}
