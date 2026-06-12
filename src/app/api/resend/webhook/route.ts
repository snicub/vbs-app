import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

function validateResendSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const key = Buffer.from(secret.replace("whsec_", ""), "base64");
  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(toSign)
    .digest("base64");
  return signatureHeader.split(" ").some((sig) => {
    const value = sig.replace("v1,", "");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(value),
      );
    } catch {
      return false;
    }
  });
}

type ResendEvent = {
  type?: string;
  data?: { email_id?: string };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!env.RESEND_WEBHOOK_SECRET) {
    if (env.NODE_ENV === "production") {
      return new NextResponse("Webhook secret not configured", { status: 503 });
    }
  } else if (env.RESEND_WEBHOOK_SECRET) {
    const svixId = request.headers.get("svix-id") ?? "";
    const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
    const svixSignature = request.headers.get("svix-signature") ?? "";
    if (
      !svixId ||
      !svixTimestamp ||
      !svixSignature ||
      !validateResendSignature(
        env.RESEND_WEBHOOK_SECRET,
        svixId,
        svixTimestamp,
        rawBody,
        svixSignature,
      )
    ) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const payload = JSON.parse(rawBody) as ResendEvent | null;
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
