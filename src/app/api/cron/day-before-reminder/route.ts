import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getLocalTomorrow } from "@/lib/date";
import { sendSms } from "@/lib/notifications/send";
import { dayBeforeReminder } from "@/lib/notifications/templates";

export const dynamic = "force-dynamic";

type DayRecord = {
  id: string;
  student_id: string;
  event_date: string;
  morning_stop_id: string | null;
  students: {
    legal_first_name: string;
    legal_last_name: string;
    preferred_first_name: string | null;
    families: {
      id: string;
      primary_guardian_name: string;
      primary_phone: string;
      sms_opted_out_at: string | null;
    } | null;
  } | null;
  stops: { name: string; scheduled_am_time: string } | null;
};

/**
 * Vercel cron handler. Configure in vercel.json:
 *   { "crons": [{ "path": "/api/cron/day-before-reminder", "schedule": "0 0 * * *" }] }
 *   (00:00 UTC = 19:00 America/Chicago CDT, i.e. 7 PM the evening before.)
 *
 * Requires `Authorization: Bearer <CRON_SECRET>` header when CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  // Fail closed: if CRON_SECRET isn't set, the endpoint is unreachable.
  // This prevents an empty/missing env var from accidentally exposing the
  // cron route to the open internet (it would otherwise let anyone trigger
  // SMS to every non-opted-out family).
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "cron disabled" }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const target = getLocalTomorrow();

  const admin = createAdminClient();
  const { data: records, error } = await admin
    .from("student_day_records")
    .select(
      "id, student_id, event_date, morning_stop_id, students(legal_first_name, legal_last_name, preferred_first_name, families(id, primary_guardian_name, primary_phone, sms_opted_out_at)), stops:morning_stop_id(name, scheduled_am_time)",
    )
    .eq("event_date", target)
    .eq("attending", true)
    .returns<DayRecord[]>();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Cross-run dedup: a Vercel retry or manual re-trigger shouldn't double-text.
  // Skip families already reminded in the last ~20h (the cron runs once/day, so
  // the window never overlaps the next day's target).
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data: already } = await admin
    .from("notifications_sent")
    .select("family_id")
    .eq("template_key", "day_before_reminder")
    .gte("created_at", since)
    .returns<{ family_id: string | null }[]>();
  const alreadyNotified = new Set(
    (already ?? [])
      .map((r) => r.family_id)
      .filter((id): id is string => id !== null),
  );

  // Dedupe by family — two siblings shouldn't send two messages
  const familyMessages = new Map<
    string,
    { familyId: string; phone: string; body: string }
  >();
  for (const r of records ?? []) {
    const family = r.students?.families;
    if (!family || family.sms_opted_out_at) continue;
    if (alreadyNotified.has(family.id)) continue;
    if (familyMessages.has(family.id)) continue;
    const stop = r.stops;
    const studentName = r.students?.preferred_first_name ?? r.students?.legal_first_name ?? "your child";

    const tpl = dayBeforeReminder({
      guardianName: family.primary_guardian_name,
      studentName,
      pickupTime: stop?.scheduled_am_time?.slice(0, 5) ?? undefined,
      stopName: stop?.name ?? undefined,
    });
    familyMessages.set(family.id, {
      familyId: family.id,
      phone: family.primary_phone,
      body: tpl.body,
    });
  }

  let sent = 0;
  const entries = Array.from(familyMessages.values());
  const BATCH_SIZE = 15;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((msg) =>
        sendSms({
          familyId: msg.familyId,
          to: msg.phone,
          body: msg.body,
          templateKey: "day_before_reminder",
        }),
      ),
    );
    sent += results.filter(
      (r) => r.status === "fulfilled" && r.value.ok,
    ).length;
  }

  // Capacity check for tomorrow — alert coordinator if any van exceeds capacity
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

  return NextResponse.json({ ok: true, sent, target, capacityOver: over });
}
