import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "QUIT", "END", "OPTOUT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP", "SUBSCRIBE"]);

export function isStopKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(body.trim().toUpperCase());
}

export function isStartKeyword(body: string): boolean {
  return START_KEYWORDS.has(body.trim().toUpperCase());
}

/**
 * Handle a Twilio inbound SMS body. Returns whether the message was a
 * recognized opt-out/opt-in keyword (so the webhook can decide whether to
 * auto-reply).
 */
export async function handleInboundSms(
  fromPhone: string,
  body: string,
): Promise<{ handled: boolean; kind: "stop" | "start" | "other" }> {
  const admin = createAdminClient();

  if (isStopKeyword(body)) {
    await admin
      .from("families")
      .update({ sms_opted_out_at: new Date().toISOString() } as never)
      .eq("primary_phone", fromPhone);
    return { handled: true, kind: "stop" };
  }
  if (isStartKeyword(body)) {
    await admin
      .from("families")
      .update({ sms_opted_out_at: null } as never)
      .eq("primary_phone", fromPhone);
    return { handled: true, kind: "start" };
  }
  return { handled: false, kind: "other" };
}
