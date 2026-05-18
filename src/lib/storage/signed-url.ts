import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_TTL_SECONDS = 60 * 30; // 30 min

/**
 * Resolve a short-lived signed URL for a private storage object. Returns null
 * if the object doesn't exist or the bucket is misconfigured.
 */
export async function signedUrlFor(
  bucket: "student-photos" | "wristbands",
  path: string | null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data.signedUrl;
}
