"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isCoordinator } from "@/lib/auth/roles";
import { isValidHexColor } from "@/lib/validators";

const UpdateStopColorSchema = z.object({
  stopId: z.string().uuid(),
  colorCode: z
    .string()
    .trim()
    .refine(isValidHexColor, "Color must be a 6-digit hex like #1a2b3c"),
  colorName: z.string().trim().min(1, "Color name is required").max(40),
});

export type UpdateStopColorResult = { ok: true } | { ok: false; error: string };

/**
 * Coordinator-only: change a stop's color. Colors fan out through the
 * student_day_status view to wristband swatches, name tags, the van map, and
 * the parent page, so editing here updates them everywhere.
 */
export async function updateStopColor(
  input: unknown,
): Promise<UpdateStopColorResult> {
  const user = await getSessionUser();
  if (!user || !isCoordinator(user.role)) {
    return { ok: false, error: "Coordinator access required" };
  }

  const parsed = UpdateStopColorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { stopId, colorCode, colorName } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("stops")
    .update({ color_code: colorCode, color_name: colorName } as never)
    .eq("id", stopId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/coordinator", "layout");
  revalidatePath("/table", "layout");
  revalidatePath("/van", "layout");
  return { ok: true };
}
