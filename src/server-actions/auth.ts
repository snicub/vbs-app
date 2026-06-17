"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { linkGuardianToUser } from "@/lib/auth/link-guardian";

const SignInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/**
 * Email + password sign-in. We dropped the magic-link / email-code flow — staff
 * sign in directly, no inbox round-trip. Passwords are set out-of-band by an
 * admin (`pnpm set-password <email> <password>`); families never sign in (they
 * use their no-login status URL).
 */
export async function signIn(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SignInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    return { ok: false, error: "Wrong email or password." };
  }

  await linkGuardianToUser(data.user.id, data.user.email ?? parsed.data.email);
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
