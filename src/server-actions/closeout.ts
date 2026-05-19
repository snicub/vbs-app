"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";

const CloseoutSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

export async function closeoutDay(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) return { ok: false, error: "Coordinator only" };

  const parsed = CloseoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const supabase = await createClient();

  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, state, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck")
    .eq("event_date", parsed.data.eventDate);

  const { error } = await supabase.from("daily_closeouts").upsert(
    {
      event_date: parsed.data.eventDate,
      closed_by_user_id: user.id,
      notes: parsed.data.notes ?? null,
      pending_anomalies: statuses ?? [],
    } as never,
    { onConflict: "event_date" },
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/coordinator", "layout");
  return { ok: true };
}

export async function reopenDay(input: unknown): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) return { ok: false, error: "Coordinator only" };

  const parsed = z
    .object({ eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("daily_closeouts")
    .delete()
    .eq("event_date", parsed.data.eventDate);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  return { ok: true };
}
