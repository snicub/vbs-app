/* eslint-disable no-console */
import WebSocket from "ws";
// @ts-expect-error global polyfill
globalThis.WebSocket ??= WebSocket;

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const VALID_ROLES = [
  "parent",
  "driver",
  "aide",
  "table_volunteer",
  "coordinator",
  "admin",
] as const;

const email = process.argv[2];
const role = process.argv[3];

if (!email || !role) {
  console.error("Usage: pnpm set-role <email> <role>");
  console.error(`  role ∈ {${VALID_ROLES.join(", ")}}`);
  process.exit(1);
}
const emailLower = email.toLowerCase();
const roleStr: string = role;
if (!(VALID_ROLES as readonly string[]).includes(roleStr)) {
  console.error(`Invalid role: ${roleStr}. Must be one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: list, error } = await db.auth.admin.listUsers();
  if (error) throw error;
  const authUser = list.users.find((u) => u.email?.toLowerCase() === emailLower);
  if (!authUser) {
    console.error(`No auth user for ${email}. Sign them in once at /login first.`);
    process.exit(2);
  }

  const { error: upsertErr } = await db.from("users").upsert(
    {
      id: authUser.id,
      full_name: authUser.email ?? email,
      email: authUser.email ?? email,
      role: roleStr,
    } as never,
    { onConflict: "id" },
  );
  if (upsertErr) throw upsertErr;

  console.log(`✓ ${email} is now: ${roleStr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
