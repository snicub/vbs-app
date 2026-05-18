import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
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
 *   { "crons": [{ "path": "/api/cron/day-before-reminder", "schedule": "0 19 * * *" }] }
 *
 * Requires `Authorization: Bearer <CRON_SECRET>` header when CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  if (env.CRON_SECRET) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = tomorrow.toISOString().slice(0, 10);

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

  let sent = 0;
  for (const r of records ?? []) {
    const family = r.students?.families;
    if (!family || family.sms_opted_out_at) continue;
    const stop = r.stops;
    const studentName = r.students?.preferred_first_name ?? r.students?.legal_first_name ?? "your child";

    const tpl = dayBeforeReminder({
      guardianName: family.primary_guardian_name,
      studentName,
      pickupTime: stop?.scheduled_am_time?.slice(0, 5) ?? undefined,
      stopName: stop?.name ?? undefined,
    });

    const result = await sendSms({
      familyId: family.id,
      to: family.primary_phone,
      body: tpl.body,
      templateKey: "day_before_reminder",
    });
    if (result.ok) sent++;
  }

  return NextResponse.json({ ok: true, sent, target });
}
