import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AppShell } from "./app-shell";

/**
 * Server component used by route-group layouts. Redirects unauthenticated
 * requests to /login. Wraps children in the persistent AppShell with
 * role-aware nav.
 */
export async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
