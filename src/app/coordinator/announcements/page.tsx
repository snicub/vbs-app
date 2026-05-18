import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { AnnouncementForm } from "./announcement-form";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) return <main className="p-6">Not permitted.</main>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-2xl font-semibold">Broadcast announcement</h1>
      <p className="text-muted-foreground text-sm">
        Send a single SMS to every family that hasn&apos;t opted out.
        Useful for last-minute schedule changes or weather alerts.
      </p>
      <AnnouncementForm />
    </main>
  );
}
