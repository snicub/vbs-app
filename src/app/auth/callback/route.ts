import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * Magic-link callback. Supabase Auth sends the user here with `?code=...`
 * (or as a hash from older clients). We exchange for a session, then link
 * the user to their guardian record by email match if applicable.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", env.NEXT_PUBLIC_BASE_URL));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "unknown")}`, env.NEXT_PUBLIC_BASE_URL),
    );
  }

  await linkGuardianRecord(data.user.id, data.user.email);

  return NextResponse.redirect(new URL(next, env.NEXT_PUBLIC_BASE_URL));
}

async function linkGuardianRecord(userId: string, email: string | undefined): Promise<void> {
  if (!email) return;

  const admin = createAdminClient();

  // Ensure a public.users row exists. Default role 'parent' unless coordinator
  // promoted them earlier (in which case the row already exists with the role
  // set and our upsert preserves it via ON CONFLICT DO NOTHING semantics).
  await admin.from("users").upsert(
    { id: userId, full_name: email, email, role: "parent" } as never,
    { onConflict: "id", ignoreDuplicates: true } as never,
  );

  // Link guardians.user_id where email matches and not already linked.
  await admin
    .from("guardians")
    .update({ user_id: userId } as never)
    .ilike("email", email)
    .is("user_id", null);
}
