import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";

export default async function Home() {
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
