import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canDriveVan, isCoordinator } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getLocalDate } from "@/lib/date";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function VanIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canDriveVan(user.role)) {
    return <main className="p-6 text-sm">Not permitted.</main>;
  }

  const supabase = await createClient();
  const today = getLocalDate();

  const { data: myAssignment } = await supabase
    .from("van_assignments")
    .select("van_id, vans(id, name)")
    .eq("assignment_date", today)
    .or(`driver_user_id.eq.${user.id},aide_user_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle<{ van_id: string; vans: { id: string; name: string } }>();

  if (myAssignment) {
    redirect(`/van/${myAssignment.van_id}`);
  }

  // Coordinators can pick a van; everyone else gets "not assigned".
  if (isCoordinator(user.role)) {
    const { data: vans } = await supabase
      .from("vans")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .returns<{ id: string; name: string }[]>();
    return (
      <main className="mx-auto max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Pick a van</h1>
        <ul className="space-y-2">
          {(vans ?? []).map((v) => (
            <li key={v.id}>
              <Link
                href={`/van/${v.id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                {v.name}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 text-sm space-y-3">
      <h1 className="text-xl font-semibold">No van assigned today</h1>
      <p className="text-muted-foreground">
        Ask the coordinator to add you to a van assignment for today.
      </p>
    </main>
  );
}
