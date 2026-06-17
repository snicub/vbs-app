import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { UserRole } from "@/types/domain";
import type { SessionUser } from "./roles";

type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
};

/**
 * Resolve the acting user + role.
 *
 * No-login mode (opt-in via ALLOW_NO_LOGIN): staff don't sign in. When there's
 * no session we act as the coordinator/admin on file, so every staff screen
 * opens and writes (events, etc.) attribute to a real users row that
 * record_event can verify. If someone IS signed in, their real identity + role
 * wins regardless of the flag.
 *
 * When ALLOW_NO_LOGIN is off (the default), an unauthenticated request returns
 * null → the caller redirects to login. This is the safe default: no-login
 * grants coordinator authority to anyone who can reach the app, so it must be a
 * deliberate per-environment choice, never an accident of deployment.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("id, full_name, email, role")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();
    if (profile) {
      return {
        id: profile.id,
        email: profile.email ?? user.email ?? null,
        role: profile.role,
        fullName: profile.full_name,
      };
    }
    return { id: user.id, email: user.email ?? null, role: "parent", fullName: user.email ?? "Unnamed" };
  }

  // No one signed in. Without no-login mode explicitly enabled, deny — a deploy
  // reachable from the public internet must not silently grant coordinator power.
  if (!env.ALLOW_NO_LOGIN) return null;

  // No-login mode → act as the coordinator/admin on file (the oldest one).
  // Requires at least one admin/coordinator row (set once via `pnpm set-role`).
  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("users")
    .select("id, full_name, email, role")
    .in("role", ["admin", "coordinator"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<ProfileRow>();

  return staff
    ? { id: staff.id, email: staff.email, role: staff.role, fullName: staff.full_name }
    : null;
}
