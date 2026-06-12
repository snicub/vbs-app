import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { handleInboundSms } from "@/lib/notifications/opt-out";
import { env } from "@/lib/env";

function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });

  if (!env.TWILIO_AUTH_TOKEN) {
    if (env.NODE_ENV === "production") {
      return new NextResponse("Webhook secret not configured", { status: 503 });
    }
  } else {
    const sig = request.headers.get("x-twilio-signature") ?? "";
    const url = `${env.NEXT_PUBLIC_BASE_URL}/api/twilio/inbound`;
    if (!validateTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, sig)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const from = (params.From ?? "").trim();
  const body = (params.Body ?? "").trim();

  if (from && body) {
    await handleInboundSms(from, body);
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response/>`,
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}
