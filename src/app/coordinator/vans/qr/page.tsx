import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { zoneStopIdForVan, type DirectionRoute } from "@/lib/vans";
import { env } from "@/lib/env";
import { VanQrCodes } from "./van-qr-codes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Van QR Codes — Coordinator" };

export default async function VanQrPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();
  const [{ data: vans }, { data: stops }, { data: routes }] = await Promise.all([
    supabase.from("vans").select("id, name").eq("active", true).order("name").returns<{ id: string; name: string }[]>(),
    supabase.from("stops").select("id, color_code").returns<{ id: string; color_code: string }[]>(),
    supabase.from("routes").select("van_id, direction, stop_ids").returns<DirectionRoute[]>(),
  ]);

  const colorByVan = (vanId: string) => {
    const zoneId = zoneStopIdForVan(vanId, routes ?? []);
    return (stops ?? []).find((s) => s.id === zoneId)?.color_code ?? "#e5e7eb";
  };

  const rows = (vans ?? []).map((v) => ({ id: v.id, name: v.name, color: colorByVan(v.id) }));

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <header className="print:hidden">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Van QR codes</h1>
      </header>
      <VanQrCodes vans={rows} baseUrl={env.NEXT_PUBLIC_BASE_URL} />
    </main>
  );
}
