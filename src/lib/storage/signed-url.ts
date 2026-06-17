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

/**
 * Batch-sign many objects in a single round-trip (one admin client, one request)
 * instead of N calls to signedUrlFor. Returns a map keyed by the input path;
 * null/duplicate paths are handled, and a path that fails to sign maps to null.
 * Use this on list pages (roster, van manifest) where ~100 photos are signed at
 * once. Look up by the object's path: `urls.get(student.photo_path)`.
 */
export async function signedUrlsFor(
  bucket: "student-photos" | "wristbands",
  paths: (string | null | undefined)[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const real = Array.from(
    new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0)),
  );
  if (real.length === 0) return result;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrls(real, ttlSeconds);
  if (error || !data) {
    for (const p of real) result.set(p, null);
    return result;
  }
  for (const item of data) {
    if (item.path) result.set(item.path, item.error ? null : item.signedUrl);
  }
  // Any path the API silently omitted → explicit null, never undefined.
  for (const p of real) if (!result.has(p)) result.set(p, null);
  return result;
}
