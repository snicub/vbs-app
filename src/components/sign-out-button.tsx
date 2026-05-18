import { signOut } from "@/server-actions/auth";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";

export function SignOutButton() {
  async function action() {
    "use server";
    await signOut();
    redirect("/");
  }
  return (
    <form action={action}>
      <Button variant="ghost" size="sm" type="submit">
        Sign out
      </Button>
    </form>
  );
}
