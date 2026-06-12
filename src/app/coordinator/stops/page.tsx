import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { StopColorEditor } from "./stop-color-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stop Colors — Coordinator" };

type StopRow = {
  id: string;
  name: string;
  town: string;
  color_code: string;
  color_name: string;
};

export default async function StopColorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isCoordinator(user.role)) {
    return <main className="p-6 text-sm">Coordinator access required.</main>;
  }

  const supabase = await createClient();
  const { data: stops } = await supabase
    .from("stops")
    .select("id, name, town, color_code, color_name")
    .order("sort_order")
    .returns<StopRow[]>();

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Stop colors
        </h1>
        <p className="text-sm text-muted-foreground">
          Each town has a color. It shows on wristbands, name tags, the van map,
          and the parent status page. Changes apply everywhere immediately.
        </p>
      </header>
      <StopColorEditor
        stops={(stops ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          town: s.town,
          colorCode: s.color_code,
          colorName: s.color_name,
        }))}
      />
    </div>
  );
}
