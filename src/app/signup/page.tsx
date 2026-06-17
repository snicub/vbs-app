import { redirect } from "next/navigation";

// Registration now lives on the homepage. Keep /signup working for any shared
// links by sending it there.
export default function SignupPage() {
  redirect("/");
}
