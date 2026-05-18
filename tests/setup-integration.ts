// Integration tests run against a local Supabase. Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// Set them in .env.test or via the shell before invoking pnpm test:integration.

import { config } from "dotenv";
config({ path: ".env.test" });
config({ path: ".env.local" });
