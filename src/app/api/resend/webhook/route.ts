import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ResendEvent = {
  type?: string;
  data?: { email_id?: string };
};

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as ResendEvent | null;
  if (!payload) return NextResponse.json({ ok: false }, { status: 400 });
  const id = payload.data?.email_id;
  if (!id || !payload.type) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const statusMap: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.bounced": "failed",
    "email.complained": "failed",
  };
  const status = statusMap[payload.type];
  if (!status) return NextResponse.json({ ok: true });

  const patch: Record<string, unknown> = { status };
  if (status === "delivered") patch.delivered_at = new Date().toISOString();
  await admin.from("notifications_sent").update(patch as never).eq("provider_id", id);
  return NextResponse.json({ ok: true });
}
