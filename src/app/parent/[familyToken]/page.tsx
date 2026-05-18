import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Family Status — VBS" };

type FamilyRow = { id: string; primary_guardian_name: string };

type StudentRow = {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_first_name: string | null;
  wristband_code: string;
};

type StatusRow = {
  student_id: string;
  event_date: string;
  state: string;
  wristband_color_name: string | null;
  last_event_at: string | null;
};

export default async function ParentStatusPage({
  params,
}: {
  params: Promise<{ familyToken: string }>;
}) {
  const { familyToken } = await params;

  // The middleware excludes this route; we do token validation here via
  // the admin client (which bypasses RLS) so the family doesn't need to sign in.
  const admin = createAdminClient();

  const { data: token } = await admin
    .from("family_access_tokens")
    .select("family_id, revoked_at, expires_at")
    .eq("token", familyToken)
    .maybeSingle<{ family_id: string; revoked_at: string | null; expires_at: string | null }>();

  if (!token || token.revoked_at || (token.expires_at && new Date(token.expires_at) < new Date())) {
    notFound();
  }

  const { data: family } = await admin
    .from("families")
    .select("id, primary_guardian_name")
    .eq("id", token.family_id)
    .maybeSingle<FamilyRow>();
  if (!family) notFound();

  const { data: students } = await admin
    .from("students")
    .select("id, legal_first_name, legal_last_name, preferred_first_name, wristband_code")
    .eq("family_id", family.id)
    .returns<StudentRow[]>();

  const studentIds = (students ?? []).map((s) => s.id);
  const today = new Date().toISOString().slice(0, 10);
  const { data: statuses } = studentIds.length > 0
    ? await admin
        .from("student_day_status")
        .select("student_id, event_date, state, wristband_color_name, last_event_at")
        .eq("event_date", today)
        .in("student_id", studentIds)
        .returns<StatusRow[]>()
    : { data: [] as StatusRow[] };

  const statusMap = new Map((statuses ?? []).map((s) => [s.student_id, s]));

  return (
    <main className="mx-auto max-w-xl px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Family Status</h1>
        <p className="text-muted-foreground text-sm">Hi {family.primary_guardian_name} — here&apos;s where things stand right now.</p>
      </header>
      <ul className="space-y-3">
        {(students ?? []).map((s) => {
          const status = statusMap.get(s.id);
          const state = (status?.state ?? "not_started") as DayState;
          return (
            <li key={s.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {s.preferred_first_name ?? s.legal_first_name} {s.legal_last_name}
                </div>
                <code className="font-mono text-xs text-muted-foreground">
                  {s.wristband_code}
                </code>
              </div>
              <div className="text-lg">{STATE_LABEL[state]}</div>
              {status?.last_event_at && (
                <div className="text-xs text-muted-foreground">
                  Updated {new Date(status.last_event_at).toLocaleTimeString()}
                </div>
              )}
              {status?.wristband_color_name && (
                <div className="text-xs">
                  Wristband color: <strong>{status.wristband_color_name}</strong>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        This page refreshes when you reload. If something looks wrong, text the
        coordinator immediately.
      </p>
    </main>
  );
}
