"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

const EmailSchema = z.object({ email: z.string().email() });

export async function sendMagicLink(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_BASE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

const VerifyOtpSchema = z.object({
  email: z.string().email(),
  token: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

/**
 * Sign in by pasting the 6-digit OTP from the magic-link email.
 * Works even if the link itself was misrouted by Supabase's site_url config.
 */
export async function verifyEmailOtp(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = VerifyOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Could not verify code" };
  }

  // Link guardian record on first sign-in (mirror the /auth/callback behavior)
  const admin = createAdminClient();
  await admin
    .from("users")
    .upsert(
      {
        id: data.user.id,
        full_name: data.user.email ?? parsed.data.email,
        email: data.user.email ?? parsed.data.email,
        role: "parent",
      } as never,
      { onConflict: "id", ignoreDuplicates: true } as never,
    );
  await admin
    .from("guardians")
    .update({ user_id: data.user.id } as never)
    .ilike("email", parsed.data.email)
    .is("user_id", null);

  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
