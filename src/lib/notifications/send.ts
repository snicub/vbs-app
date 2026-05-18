import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

type SendSmsArgs = {
  familyId?: string | null;
  to: string;
  body: string;
  templateKey: string;
};

type SendEmailArgs = {
  familyId?: string | null;
  to: string;
  subject: string;
  html: string;
  templateKey: string;
};

/**
 * Send an SMS via Twilio. If credentials aren't configured, log to the
 * notifications_sent table as 'queued' with provider_id null — useful in dev.
 * Returns ok+messageSid on real send.
 */
export async function sendSms(
  args: SendSmsArgs,
): Promise<{ ok: true; sid: string | null } | { ok: false; error: string }> {
  const admin = createAdminClient();

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    await admin.from("notifications_sent").insert({
      family_id: args.familyId ?? null,
      channel: "sms",
      template_key: args.templateKey,
      recipient: args.to,
      body: args.body,
      status: "queued",
    } as never);
    return { ok: true, sid: null };
  }

  const from = env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_PHONE_NUMBER;
  if (!from) return { ok: false, error: "TWILIO_PHONE_NUMBER or messaging service required" };

  const params = new URLSearchParams();
  params.set("To", args.to);
  params.set("Body", args.body);
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set("From", env.TWILIO_PHONE_NUMBER!);
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      },
      body: params,
    },
  );

  type TwilioResponse = { sid?: string; status?: string; message?: string };
  const data = (await res.json()) as TwilioResponse;
  if (!res.ok) {
    await admin.from("notifications_sent").insert({
      family_id: args.familyId ?? null,
      channel: "sms",
      template_key: args.templateKey,
      recipient: args.to,
      body: args.body,
      status: "failed",
      error: data.message ?? "Twilio rejected the request",
    } as never);
    return { ok: false, error: data.message ?? "Twilio rejected the request" };
  }

  await admin.from("notifications_sent").insert({
    family_id: args.familyId ?? null,
    channel: "sms",
    template_key: args.templateKey,
    recipient: args.to,
    body: args.body,
    provider_id: data.sid ?? null,
    status: "sent",
    sent_at: new Date().toISOString(),
  } as never);

  return { ok: true, sid: data.sid ?? null };
}

/**
 * Send an email via Resend.
 */
export async function sendEmail(
  args: SendEmailArgs,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    await admin.from("notifications_sent").insert({
      family_id: args.familyId ?? null,
      channel: "email",
      template_key: args.templateKey,
      recipient: args.to,
      subject: args.subject,
      body: args.html,
      status: "queued",
    } as never);
    return { ok: true, id: null };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
    }),
  });
  type ResendResponse = { id?: string; message?: string };
  const data = (await res.json()) as ResendResponse;
  if (!res.ok) {
    await admin.from("notifications_sent").insert({
      family_id: args.familyId ?? null,
      channel: "email",
      template_key: args.templateKey,
      recipient: args.to,
      subject: args.subject,
      body: args.html,
      status: "failed",
      error: data.message ?? "Resend rejected the request",
    } as never);
    return { ok: false, error: data.message ?? "Resend rejected the request" };
  }
  await admin.from("notifications_sent").insert({
    family_id: args.familyId ?? null,
    channel: "email",
    template_key: args.templateKey,
    recipient: args.to,
    subject: args.subject,
    body: args.html,
    provider_id: data.id ?? null,
    status: "sent",
    sent_at: new Date().toISOString(),
  } as never);
  return { ok: true, id: data.id ?? null };
}
