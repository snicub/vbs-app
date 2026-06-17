import { z } from "zod";

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  NEXT_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),

  APP_TIMEZONE: z.string().default("America/Chicago"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  MAPBOX_TOKEN: z.string().optional(),

  COORDINATOR_NAME: z.string().optional(),
  COORDINATOR_PHONE: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),

  // CRON_SECRET is required in production. In dev/test you can omit it; the
  // cron route still fails closed when the value is missing or doesn't match,
  // so an unset secret can never accidentally expose the endpoint publicly.
  CRON_SECRET: z.string().min(16).optional(),

  // No-login (kiosk) mode: when "true", an unauthenticated request acts as the
  // coordinator/admin on file so volunteers don't sign in on shared devices.
  // OFF by default — this grants coordinator authority to anyone who can reach
  // the app, so it must be an explicit per-environment opt-in, never the default.
  // A deploy with this on MUST also be access-restricted (Vercel Deployment
  // Protection / a trusted network), since the app-layer role check no longer
  // gates anything.
  ALLOW_NO_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Google Drive folder to embed on /photos (staff uploads + family browsing).
  // Share the folder "Anyone with link → Editor" for uploads without login.
  NEXT_PUBLIC_DRIVE_FOLDER_ID: z.string().optional(),
});

const clientSchema = serverSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
  NEXT_PUBLIC_BASE_URL: true,
  NEXT_PUBLIC_SENTRY_DSN: true,
  NEXT_PUBLIC_DRIVE_FOLDER_ID: true,
});

const isServer = typeof window === "undefined";

// During `next build` (and `next lint`) most env vars aren't injected — the
// build only needs to compile, not connect. Skip strict validation in those
// phases; runtime first-use will throw if something is genuinely missing.
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-production-server" ||
  process.env.SKIP_ENV_VALIDATION === "1";

function parseEnv() {
  if (isServer) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      if (isBuildPhase) {
        // Return a placeholder; nothing in this process actually calls Supabase.
        return serverSchema.parse({
          NEXT_PUBLIC_SUPABASE_URL: "http://placeholder.local",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
          SUPABASE_SERVICE_ROLE_KEY: "placeholder",
        });
      }
      const issues = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    return parsed.data;
  }

  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_DRIVE_FOLDER_ID: process.env.NEXT_PUBLIC_DRIVE_FOLDER_ID,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid public environment variables:\n${issues}`);
  }
  return parsed.data as z.infer<typeof serverSchema>;
}

export const env = parseEnv();
