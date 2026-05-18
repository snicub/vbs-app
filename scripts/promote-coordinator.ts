/* eslint-disable no-console */
import WebSocket from "ws";
// @ts-expect-error global polyfill
globalThis.WebSocket ??= WebSocket;

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email: string | undefined = process.argv[2];
if (!email) {
  console.error("Usage: pnpm tsx scripts/promote-coordinator.ts <email>");
  process.exit(1);
}
const emailLower = email.toLowerCase();
if (!SERVICE_ROLE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function main() {
  const { data: authList, error: authErr } = await db.auth.admin.listUsers();
  if (authErr) throw authErr;
  const authUser = authList.users.find((u) => u.email?.toLowerCase() === emailLower);
  if (!authUser) {
    console.error(
      `No auth user found for ${email}. Sign in once at /login (and click the magic link in Mailpit) before running this script.`,
    );
    process.exit(2);
  }

  // Ensure public.users row exists, set role=coordinator
  const { error } = await db.from("users").upsert(
    {
      id: authUser.id,
      full_name: authUser.email ?? email,
      email: authUser.email ?? email,
      role: "coordinator",
    } as never,
    { onConflict: "id" },
  );
  if (error) throw error;

  console.log(`✓ ${email} is now a coordinator.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
