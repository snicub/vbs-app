import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";
import type { SessionUser } from "./roles";

/**
 * Resolve the current request's user + role from public.users.
 * Returns null when the request is unauthenticated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, email, role")
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string | null;
      role: UserRole;
    }>();

  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? null,
      role: "parent",
      fullName: user.email ?? "Unnamed",
    };
  }

  return {
    id: profile.id,
    email: profile.email ?? user.email ?? null,
    role: profile.role,
    fullName: profile.full_name,
  };
}
