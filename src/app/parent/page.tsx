import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

/**
 * Authenticated-parent landing. Resolves their family via guardians.user_id,
 * then redirects to /parent/<token> using their family's access token.
 */
export default async function ParentSelfPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: guardian } = await admin
    .from("guardians")
    .select("family_id")
    .eq("user_id", user.id)
    .maybeSingle<{ family_id: string }>();

  if (guardian) {
    const { data: token } = await admin
      .from("family_access_tokens")
      .select("token")
      .eq("family_id", guardian.family_id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ token: string }>();
    if (token) redirect(`/parent/${token.token}`);
  }

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-md p-6 text-sm space-y-3">
        <h1 className="text-xl font-semibold">No family on file</h1>
        <p className="text-muted-foreground">
          We can&apos;t find a family for {user.email}. If you registered a family,
          double-check the email matched what you used to sign in. Otherwise{" "}
          <a className="underline" href="/signup">register here</a>.
        </p>
      </main>
    </AppShell>
  );
}
