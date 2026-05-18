import "server-only";
import { generateWristbandCode } from "./generate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Generate N wristband codes guaranteed not to collide with existing students,
 * and not with each other. Retries up to maxAttempts per code on collision.
 */
export async function generateUniqueWristbandCodes(
  count: number,
  maxAttemptsPerCode = 32,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("students").select("wristband_code");
  if (error) throw error;
  const existing = new Set<string>((data ?? []).map((r: { wristband_code: string }) => r.wristband_code));

  const generated: string[] = [];
  for (let i = 0; i < count; i++) {
    let attempt = 0;
    let code: string | null = null;
    while (attempt < maxAttemptsPerCode) {
      const candidate = generateWristbandCode();
      if (!existing.has(candidate)) {
        existing.add(candidate);
        code = candidate;
        break;
      }
      attempt++;
    }
    if (!code) {
      throw new Error(`could not generate unique wristband code in ${maxAttemptsPerCode} attempts`);
    }
    generated.push(code);
  }
  return generated;
}
