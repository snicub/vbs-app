import { type NextRequest, NextResponse } from "next/server";
import { handleInboundSms } from "@/lib/notifications/opt-out";

/**
 * Twilio webhook for inbound SMS. Twilio expects a TwiML response —
 * we respond with no message body to avoid auto-reply (Twilio handles the
 * standard STOP confirmation itself).
 *
 * Twilio sends signed requests; in production we'd verify X-Twilio-Signature
 * against a known endpoint URL. Skipped here in dev — to add later when the
 * webhook URL is registered.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const from = String(form.get("From") ?? "").trim();
  const body = String(form.get("Body") ?? "").trim();

  if (from && body) {
    await handleInboundSms(from, body);
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response/>`,
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}
