import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// `server-only` throws on import to enforce server-context — neuter it in tests.
vi.mock("server-only", () => ({}));

// Provide placeholder env so any module that touches src/lib/env.ts at import
// time doesn't blow up. Real integration tests should override these.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://placeholder.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder";
