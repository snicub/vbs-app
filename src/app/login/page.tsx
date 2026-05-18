import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Sign in — VBS Check-In" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(routeForRole(user.role));

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">VBS Check-In</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Enter your email to receive a sign-in link.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}

function routeForRole(role: string): string {
  switch (role) {
    case "coordinator":
    case "admin":
      return "/coordinator";
    case "driver":
    case "aide":
      return "/van";
    case "table_volunteer":
      return "/table";
    default:
      return "/";
  }
}
