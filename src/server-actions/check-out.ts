"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { recordEvent } from "@/lib/events/record-event";
import type { EventType } from "@/lib/events/state-machine";
import { newIdempotencyKey } from "@/lib/idempotency";

const Schema = z.object({
  studentId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Smart "check out" — fires whichever chain of events lands the kid in
 * the terminal `home` state, based on their current state and transport
 * mode. Replaces the three-step site_checked_out → van_boarded_pm →
 * van_offloaded_pm sequence (or site_checked_out → parent_pickup).
 *
 * From the UI: one tap = "we delivered them home."
 */
export async function smartCheckOut(
  input: unknown,
): Promise<{ ok: true; finalState: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };

  const supabase = await createClient();

  const { data: statusRow } = await supabase
    .from("student_day_status")
    .select("state, mode")
    .eq("student_id", parsed.data.studentId)
    .eq("event_date", parsed.data.eventDate)
    .maybeSingle<{ state: string; mode: string }>();

  if (!statusRow) {
    return { ok: false, error: "No day record for that student/date." };
  }

  // Decide which path: van offload (van mode AM-or-PM with van) vs parent pickup.
  // We rely on the planned PM mode: if mode includes "van" for PM, use the van
  // path. mode 'parent_both' or 'parent_pickup_only' (van AM, parent PM)
  // means parent_pickup.
  const usesVanPm =
    statusRow.mode === "van" || statusRow.mode === "parent_dropoff_only";

  const chain: EventType[] = chainFor(statusRow.state, usesVanPm);

  if (chain.length === 0) {
    return { ok: false, error: `No check-out path from state '${statusRow.state}'.` };
  }

  let finalState = statusRow.state;
  for (const event of chain) {
    const r = await recordEvent({
      studentId: parsed.data.studentId,
      eventDate: parsed.data.eventDate,
      eventType: event,
      actorUserId: user.id,
      actorRole: user.role,
      idempotencyKey: newIdempotencyKey(`checkout_${event}`),
    });
    if (!r.ok) {
      return { ok: false, error: `${event}: ${r.error}` };
    }
    finalState = r.data.derivedState;
  }

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");

  return { ok: true, finalState };
}

function chainFor(state: string, usesVanPm: boolean): EventType[] {
  const vanTail: EventType[] = ["van_boarded_pm", "van_offloaded_pm"];
  const parentTail: EventType[] = ["parent_pickup"];

  switch (state) {
    case "site_checked_in":
      return ["site_checked_out", ...(usesVanPm ? vanTail : parentTail)];
    case "site_checked_out":
      return usesVanPm ? vanTail : parentTail;
    case "van_boarded_pm":
      return ["van_offloaded_pm"];
    case "home":
    case "marked_no_show":
      return [];
    default:
      return [];
  }
}
