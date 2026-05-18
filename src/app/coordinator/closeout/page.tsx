import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { CloseoutForm } from "./closeout-form";

export const dynamic = "force-dynamic";

export default async function CloseoutPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) return <main className="p-6">Not permitted.</main>;

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: closeout } = await supabase
    .from("daily_closeouts")
    .select("closed_at, notes, pending_anomalies")
    .eq("event_date", today)
    .maybeSingle<{ closed_at: string; notes: string | null; pending_anomalies: unknown }>();

  const { data: statuses } = await supabase
    .from("student_day_status")
    .select("student_id, is_late_am, is_boarded_but_not_arrived, is_in_but_not_out, is_pm_van_stuck, state")
    .eq("event_date", today)
    .returns<{
      student_id: string;
      is_late_am: boolean;
      is_boarded_but_not_arrived: boolean;
      is_in_but_not_out: boolean;
      is_pm_van_stuck: boolean;
      state: string;
    }[]>();

  const pending = (statuses ?? []).filter(
    (s) =>
      s.is_late_am ||
      s.is_boarded_but_not_arrived ||
      s.is_in_but_not_out ||
      s.is_pm_van_stuck,
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-2xl font-semibold">End-of-day closeout</h1>
      <p className="text-muted-foreground text-sm">
        Acknowledge any open anomalies and record the day as closed.
      </p>
      <CloseoutForm
        eventDate={today}
        pendingCount={pending.length}
        existing={closeout}
      />
    </main>
  );
}
