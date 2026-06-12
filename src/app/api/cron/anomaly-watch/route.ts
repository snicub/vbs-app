import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getLocalDate } from "@/lib/date";
import { sendSms } from "@/lib/notifications/send";
import { anomaliesFor, type AnomalyKind } from "@/lib/anomaly";

export const dynamic = "force-dynamic";

type AnomalyRow = {
  student_id: string;
  is_late_am: boolean;
  is_boarded_but_not_arrived: boolean;
  is_in_but_not_out: boolean;
  is_pm_van_stuck: boolean;
};

type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
};

/**
 * Vercel cron handler. Scans today's anomalies and sends a one-time SMS
 * to the coordinator phone per (student, date, anomaly_kind) tuple. Schedule
 * every 5–10 minutes during operating hours via vercel.json.
 *
 * Auth: same Bearer CRON_SECRET as the day-before-reminder route.
 */
export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "cron disabled" }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!env.COORDINATOR_PHONE) {
    return NextResponse.json(
      { ok: false, error: "COORDINATOR_PHONE not set" },
      { status: 503 },
    );
  }

  const today = getLocalDate();
  const admin = createAdminClient();

  const { data: anomalies, error } = await admin
    .from("student_day_status")
    .select(
      "student_id, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck",
    )
    .eq("event_date", today)
    .or(
      "is_late_am.eq.true,is_boarded_but_not_arrived.eq.true,is_in_but_not_out.eq.true,is_pm_van_stuck.eq.true",
    )
    .returns<AnomalyRow[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!anomalies || anomalies.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 });
  }

  // Flatten to (student_id, anomaly_kind) pairs
  type Pair = { studentId: string; kind: AnomalyKind };
  const pairs: Pair[] = [];
  for (const a of anomalies) {
    const kinds = anomaliesFor({
      isLateAm: a.is_late_am,
      isBoardedButNotArrived: a.is_boarded_but_not_arrived,
      isInButNotOut: a.is_in_but_not_out,
      isPmVanStuck: a.is_pm_van_stuck,
    });
    for (const kind of kinds) pairs.push({ studentId: a.student_id, kind });
  }

  // Filter pairs against already-notified rows
  const studentIds = Array.from(new Set(pairs.map((p) => p.studentId)));
  const { data: alreadyNotified } = await admin
    .from("anomaly_notifications")
    .select("student_id, anomaly_kind")
    .eq("event_date", today)
    .in("student_id", studentIds)
    .returns<{ student_id: string; anomaly_kind: string }[]>();
  const seen = new Set<string>(
    (alreadyNotified ?? []).map((r) => `${r.student_id}:${r.anomaly_kind}`),
  );

  const newAlerts = pairs.filter((p) => !seen.has(`${p.studentId}:${p.kind}`));
  if (newAlerts.length === 0) {
    return NextResponse.json({ ok: true, scanned: pairs.length, sent: 0 });
  }

  // Load student names for the alerts
  const newStudentIds = Array.from(new Set(newAlerts.map((p) => p.studentId)));
  const { data: students } = await admin
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
    .in("id", newStudentIds)
    .returns<StudentRow[]>();
  const studentMap = new Map((students ?? []).map((s) => [s.id, s]));

  const ANOMALY_LABEL: Record<AnomalyKind, string> = {
    late_am: "is late for AM pickup",
    boarded_but_not_arrived: "boarded AM van but didn't arrive at site",
    in_but_not_out: "still checked in past PM start",
    pm_van_stuck: "PM van stuck — 2h+ since boarded",
  };

  // Claim-then-send pattern: insert the dedup row first inside the unique
  // constraint to serialize concurrent cron invocations. If two ticks race,
  // only one wins the insert; the loser gets a unique-violation and skips
  // the SMS. On Twilio failure we delete the claim so the next tick retries.
  const link = `${env.NEXT_PUBLIC_BASE_URL}/coordinator`;
  let sent = 0;
  const BATCH_SIZE = 15;

  async function processAlert(alert: { studentId: string; kind: AnomalyKind }) {
    const stu = studentMap.get(alert.studentId);
    if (!stu) return false;

    // Atomic claim — Postgres unique-violation = another worker beat us.
    const { error: claimErr } = await admin.from("anomaly_notifications").insert({
      student_id: alert.studentId,
      event_date: today,
      anomaly_kind: alert.kind,
    } as never);
    if (claimErr) return false;

    const name = `${stu.preferred_first_name ?? stu.legal_first_name} ${stu.legal_last_name}`;
    const body = `VBS: ${name} (${stu.wristband_code}) ${ANOMALY_LABEL[alert.kind]}. ${link}`;
    const result = await sendSms({
      to: env.COORDINATOR_PHONE!,
      body,
      templateKey: "anomaly_alert",
    });
    if (!result.ok) {
      // Roll back the claim so the next tick can retry after Twilio recovers.
      await admin
        .from("anomaly_notifications")
        .delete()
        .eq("student_id", alert.studentId)
        .eq("event_date", today)
        .eq("anomaly_kind", alert.kind);
      return false;
    }
    return true;
  }

  for (let i = 0; i < newAlerts.length; i += BATCH_SIZE) {
    const batch = newAlerts.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(processAlert));
    sent += results.filter((r) => r.status === "fulfilled" && r.value).length;
  }

  return NextResponse.json({ ok: true, scanned: pairs.length, sent });
}
