import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { AppShell } from "@/components/app-shell";

export default async function CoordinatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return (
      <AppShell user={user}>
        <main className="mx-auto max-w-2xl px-4 py-10 text-sm">
          <h1 className="text-lg font-semibold mb-2">Not permitted</h1>
          <p className="text-muted-foreground">
            This area is for coordinators only. You&apos;re signed in as{" "}
            <strong>{user.role}</strong>.
          </p>
        </main>
      </AppShell>
    );
  }
  return <AppShell user={user}>{children}</AppShell>;
}
