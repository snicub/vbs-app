import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getLocalTomorrow } from "@/lib/date";
import { sendSms } from "@/lib/notifications/send";

export const dynamic = "force-dynamic";

/**
 * Vercel cron handler. Configure in vercel.json:
 *   { "crons": [{ "path": "/api/cron/capacity-check", "schedule": "0 0 * * *" }] }
 *   (00:00 UTC = 19:00 America/Chicago, i.e. 7 PM the evening before.)
 *
 * Checks tomorrow's DERIVED van loads (AM + PM) and, if any active van is
 * assigned more riders than its capacity, texts the coordinator so they can
 * reassign before the morning. No family-facing messages — staff safety alert
 * only. Requires `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  // Fail closed: a missing CRON_SECRET disables the endpoint rather than
  // exposing it to the open internet.
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "cron disabled" }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const target = getLocalTomorrow();
  const admin = createAdminClient();

  type VanRow = { id: string; name: string; capacity: number };
  type StatusRow = { morning_van_id: string | null; afternoon_van_id: string | null };
  const [{ data: vans }, { data: tomorrowStatuses }] = await Promise.all([
    admin.from("vans").select("id, name, capacity").eq("active", true).returns<VanRow[]>(),
    admin
      .from("student_day_status")
      .select("morning_van_id, afternoon_van_id")
      .eq("event_date", target)
      .eq("attending", true)
      .returns<StatusRow[]>(),
  ]);

  const amCounts = new Map<string, number>();
  const pmCounts = new Map<string, number>();
  for (const s of tomorrowStatuses ?? []) {
    if (s.morning_van_id) amCounts.set(s.morning_van_id, (amCounts.get(s.morning_van_id) ?? 0) + 1);
    if (s.afternoon_van_id) pmCounts.set(s.afternoon_van_id, (pmCounts.get(s.afternoon_van_id) ?? 0) + 1);
  }

  const over: { name: string; direction: "AM" | "PM"; count: number; capacity: number }[] = [];
  for (const v of vans ?? []) {
    const am = amCounts.get(v.id) ?? 0;
    const pm = pmCounts.get(v.id) ?? 0;
    if (am > v.capacity) over.push({ name: v.name, direction: "AM", count: am, capacity: v.capacity });
    if (pm > v.capacity) over.push({ name: v.name, direction: "PM", count: pm, capacity: v.capacity });
  }

  if (over.length > 0 && env.COORDINATOR_PHONE) {
    const summary = over
      .map((o) => `${o.name} ${o.direction}: ${o.count}/${o.capacity}`)
      .join(", ");
    await sendSms({
      to: env.COORDINATOR_PHONE,
      body: `VBS capacity alert for ${target}: ${summary}. Reassign before tomorrow.`,
      templateKey: "capacity_alert",
    });
  }

  return NextResponse.json({ ok: true, target, capacityOver: over });
}
