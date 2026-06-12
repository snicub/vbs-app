import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { linkGuardianToUser } from "@/lib/auth/link-guardian";

/**
 * Magic-link callback. Supabase Auth sends the user here with `?code=...`
 * (or as a hash from older clients). We exchange for a session, then link
 * the user to their guardian record by email match if applicable.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/";
  const next = /^\/[^/\\]/.test(rawNext) ? rawNext : "/";

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

  await linkGuardianToUser(data.user.id, data.user.email);

  return NextResponse.redirect(new URL(next, env.NEXT_PUBLIC_BASE_URL));
}
