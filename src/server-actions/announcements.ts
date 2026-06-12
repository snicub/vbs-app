"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/notifications/send";

const Schema = z.object({
  body: z.string().trim().min(1).max(320),
});

export async function broadcastAnnouncement(
  input: unknown,
): Promise<{ ok: true; recipients: number } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) return { ok: false, error: "Coordinator only" };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Message is required (≤ 320 chars)" };

  const admin = createAdminClient();
  const { data: families, error } = await admin
    .from("families")
    .select("id, primary_phone, primary_email, sms_opted_out_at")
    .returns<{
      id: string;
      primary_phone: string;
      primary_email: string;
      sms_opted_out_at: string | null;
    }[]>();
  if (error) return { ok: false, error: error.message };

  const eligible = (families ?? []).filter((f) => !f.sms_opted_out_at);

  let queued = 0;
  const BATCH_SIZE = 15;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((family) =>
        sendSms({
          familyId: family.id,
          to: family.primary_phone,
          body: parsed.data.body,
          templateKey: "announcement",
        }),
      ),
    );
    queued += results.filter(
      (r) => r.status === "fulfilled" && r.value.ok,
    ).length;
  }

  return { ok: true, recipients: queued };
}
