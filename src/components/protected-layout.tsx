import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AppShell } from "./app-shell";
import { RealtimeRefresher } from "./realtime-refresher";

/**
 * Server component used by route-group layouts. Redirects unauthenticated
 * requests to /login. Wraps children in the persistent AppShell with
 * role-aware nav. Mounts a single realtime subscription so all child
 * routes get live updates without each having to subscribe individually.
 */
export async function ProtectedLayout({
  children,
  channelName = "app-realtime",
}: {
  children: React.ReactNode;
  channelName?: string;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <RealtimeRefresher channelName={channelName} />
      {children}
    </AppShell>
  );
}
