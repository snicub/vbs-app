import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createAdminClient } from "./admin";
import type { Database } from "./types";

/**
 * Server-side Supabase client for pages + server actions.
 *
 * No-login mode: staff don't sign in (the coordinator keeps the dashboard URL
 * private), so when there's no auth-session cookie we operate as the service
 * role — every staff screen and action works without a login, and writes are
 * attributed to the coordinator/admin on file (see getSessionUser). If someone
 * DOES sign in (optional), their cookie-bound, RLS-scoped client is used.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore.getAll().some((c) => c.name.includes("-auth-token"));
  if (!hasAuthCookie) {
    return createAdminClient();
  }

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll from a Server Component; ignored because middleware refreshes.
          }
        },
      },
    },
  );
}
