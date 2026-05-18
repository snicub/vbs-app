import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Twilio delivery-status callback. Updates notifications_sent.status by
 * provider_id (the Message SID).
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const sid = String(form.get("MessageSid") ?? "");
  const status = String(form.get("MessageStatus") ?? "");
  if (!sid) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const patch: Record<string, unknown> = { status };
  if (status === "delivered") patch.delivered_at = new Date().toISOString();
  await admin.from("notifications_sent").update(patch as never).eq("provider_id", sid);

  return NextResponse.json({ ok: true });
}
