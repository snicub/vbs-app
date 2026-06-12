import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/registration/schema";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "QUIT", "END", "OPTOUT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP", "SUBSCRIBE"]);

export function isStopKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(body.trim().toUpperCase());
}

export function isStartKeyword(body: string): boolean {
  return START_KEYWORDS.has(body.trim().toUpperCase());
}

/**
 * Handle a Twilio inbound SMS body. Matches the from-number against both
 * raw and E.164-normalized variants so families with legacy non-normalized
 * phone formats still get opted out. Also matches against guardians.phone
 * so a second guardian's STOP opts out the whole family.
 */
export async function handleInboundSms(
  fromPhone: string,
  body: string,
): Promise<{ handled: boolean; kind: "stop" | "start" | "other" }> {
  const admin = createAdminClient();
  const normalized = normalizePhone(fromPhone);
  const variants = Array.from(new Set([fromPhone, normalized]));

  async function findFamilyIds(): Promise<string[]> {
    const ids = new Set<string>();
    const { data: fams } = await admin
      .from("families")
      .select("id")
      .in("primary_phone", variants)
      .returns<{ id: string }[]>();
    (fams ?? []).forEach((f) => ids.add(f.id));

    const { data: guards } = await admin
      .from("guardians")
      .select("family_id")
      .in("phone", variants)
      .returns<{ family_id: string }[]>();
    (guards ?? []).forEach((g) => ids.add(g.family_id));

    return Array.from(ids);
  }

  if (isStopKeyword(body)) {
    const ids = await findFamilyIds();
    if (ids.length > 0) {
      await admin
        .from("families")
        .update({ sms_opted_out_at: new Date().toISOString() } as never)
        .in("id", ids);
    }
    return { handled: true, kind: "stop" };
  }
  if (isStartKeyword(body)) {
    const ids = await findFamilyIds();
    if (ids.length > 0) {
      await admin
        .from("families")
        .update({ sms_opted_out_at: null } as never)
        .in("id", ids);
    }
    return { handled: true, kind: "start" };
  }
  return { handled: false, kind: "other" };
}
