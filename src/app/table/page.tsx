import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canCheckIn } from "@/lib/auth/roles";
import { TableSearchClient } from "./table-search-client";

export const metadata = { title: "Check-In Table — VBS" };
export const dynamic = "force-dynamic";

export default async function TablePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canCheckIn(user.role)) {
    return (
      <main className="p-6 max-w-md mx-auto text-sm">
        <h1 className="text-lg font-semibold mb-2">Not permitted</h1>
        <p>You don&apos;t have access to the check-in table.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Check-In Table</h1>
        <p className="text-muted-foreground text-sm">
          Scan or type a 5-character wristband code.
        </p>
      </header>
      <TableSearchClient />
    </main>
  );
}
