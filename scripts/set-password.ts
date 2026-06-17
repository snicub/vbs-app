/* eslint-disable no-console */
// Set (or create) a staff login password without any email round-trip.
//
//   pnpm set-password <email> <password>
//
// Finds the auth user by email and sets the password (email auto-confirmed),
// or creates the user if they don't exist yet. Run `pnpm set-role <email>
// coordinator` afterward if they still need a role.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, password] = process.argv.slice(2);

if (!URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email || !password) {
  console.error("Usage: pnpm set-password <email> <password>");
  process.exit(1);
}

const db = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function findUserId(target: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const existingId = await findUserId(email!);
  if (existingId) {
    const { error } = await db.auth.admin.updateUserById(existingId, {
      password: password!,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`Password set for existing user ${email}`);
  } else {
    const { error } = await db.auth.admin.createUser({
      email: email!,
      password: password!,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`Created user ${email} with a password`);
  }
  console.log(`Sign in at /login with ${email} and the password you set.`);
  console.log(`If this user isn't a coordinator/admin yet: pnpm set-role ${email} coordinator`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
