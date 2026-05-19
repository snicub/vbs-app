"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";

const Schema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Smart "check out" — calls the public.smart_checkout() Postgres function
 * which chains site_checked_out → (van_boarded_pm + van_offloaded_pm) for
 * van mode, or site_checked_out → parent_pickup for parent mode. The
 * whole chain runs in a single transaction under one advisory lock — no
 * partial-failure ambiguity.
 *
 * The previous JS-level chain executed each event in its own transaction,
 * which left brief windows where coordinators could observe an
 * intermediate state. This version is atomic.
 */
export async function smartCheckOut(
  input: unknown,
): Promise<{ ok: true; finalState: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  // The RPC is SECURITY DEFINER + granted to authenticated, so we can use
  // either client. We use admin to make the role explicit regardless of
  // who's calling.
  const supabase = user.role === "parent"
    ? await createClient()
    : createAdminClient();

  const { data, error } = await supabase.rpc("smart_checkout", {
    p_student_id: parsed.data.studentId,
    p_event_date: parsed.data.eventDate,
    p_actor_user_id: user.id,
    p_actor_role: user.role,
  } as never);

  if (error) {
    return { ok: false, error: error.message };
  }

  type Row = { final_state: string; events_recorded: number };
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) return { ok: false, error: "smart_checkout returned no row" };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, finalState: row.final_state };
}
