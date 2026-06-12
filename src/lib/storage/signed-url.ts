import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// VBS days run ~7am to ~5pm; we want signed URLs to outlast a single
// viewing session without re-signing. 14 hours covers a full shift from
// pre-dawn van prep through post-PM closeout, so an aide can leave a
// tab open all day and the photo modal still works at PM offload.
const DEFAULT_TTL_SECONDS = 60 * 60 * 14;

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
