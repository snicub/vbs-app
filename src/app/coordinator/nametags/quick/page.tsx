import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { QuickNameTag } from "./quick-nametag";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quick Name Tag — Coordinator" };

export default async function QuickNameTagPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();
  const [{ data: vans }, { data: stops }, { data: routes }] = await Promise.all([
    supabase.from("vans").select("id, name").eq("active", true).order("name").returns<{ id: string; name: string }[]>(),
    supabase.from("stops").select("id, color_code, color_name").returns<{ id: string; color_code: string; color_name: string }[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<DirectionRoute[]>(),
  ]);

  const regions = (vans ?? []).map((v) => {
    const zoneId = zoneStopIdForVan(v.id, routes ?? []);
    const stop = zoneId ? (stops ?? []).find((s) => s.id === zoneId) : undefined;
    return { id: v.id, name: v.name, colorCode: stop?.color_code ?? null, colorName: stop?.color_name ?? null };
  });

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6">
      <QuickNameTag regions={regions} />
    </main>
  );
}
