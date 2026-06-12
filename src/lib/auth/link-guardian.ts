import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Link a freshly-authenticated auth.user to their guardian record by email
 * match. Idempotent: runs on every sign-in but only does work on the first.
 *
 * CLAUDE.md allows two families to share an email. The previous
 * implementation did `.update().ilike(email).is(user_id null)` which
 * claimed EVERY unlinked guardian row matching the email — the second
 * family's parent was then permanently locked out. We instead link the
 * NEWEST unlinked guardian (most likely the parent who just registered).
 * If multiple unlinked rows still exist after, the coordinator can fix
 * them manually via Supabase Studio.
 */
export async function linkGuardianToUser(
  userId: string,
  email: string | undefined,
): Promise<void> {
  if (!email) return;
  const admin = createAdminClient();

  await admin.from("users").upsert(
    { id: userId, full_name: email, email, role: "parent" } as never,
    { onConflict: "id", ignoreDuplicates: true } as never,
  );

  const { data: candidate } = await admin
    .from("guardians")
    .select("id")
    .ilike("email", email)
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (candidate) {
    await admin
      .from("guardians")
      .update({ user_id: userId } as never)
      .eq("id", candidate.id);
  }
}
