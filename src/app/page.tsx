import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error_description?: string }>;
}) {
  const { code, error_description } = await searchParams;

  // Supabase sometimes routes magic links straight to `/?code=...` instead of
  // `/auth/callback?code=...` (depends on site_url config). Handle both here.
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await linkGuardian(data.user.id, data.user.email);
    }
    redirect("/");  // clean URL, then fall into the session-aware branch below
  }

  const user = await getSessionUser();
  if (user) {
    switch (user.role) {
      case "coordinator":
      case "admin":
        redirect("/coordinator");
      case "driver":
      case "aide":
        redirect("/van");
      case "table_volunteer":
        redirect("/table");
      default:
        redirect("/parent");
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">VBS Check-In</h1>
        <p className="text-muted-foreground mt-2">
          Sign in to manage check-in for Vacation Bible School.
        </p>
        {error_description && (
          <p className="mt-3 text-sm text-destructive">{decodeURIComponent(error_description)}</p>
        )}
      </div>
      <div className="flex gap-3">
        <Link href="/login" className={buttonVariants({ size: "lg" })}>
          Sign in
        </Link>
        <Link href="/signup" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Register a family
        </Link>
      </div>
    </main>
  );
}

async function linkGuardian(userId: string, email: string | undefined) {
  if (!email) return;
  const admin = createAdminClient();
  await admin
    .from("users")
    .upsert(
      { id: userId, full_name: email, email, role: "parent" } as never,
      { onConflict: "id", ignoreDuplicates: true } as never,
    );
  await admin
    .from("guardians")
    .update({ user_id: userId } as never)
    .ilike("email", email)
    .is("user_id", null);
}
