import { createAdminClient } from "@/lib/supabase/admin";
import { SignupForm } from "./signup-form";
import { consentText, CONSENT_TEXT, CONSENT_VERSION } from "@/lib/consents/text";
import { hashConsentText } from "@/lib/consents/hash";
import type { ConsentKind } from "@/types/domain";

export const metadata = { title: "Register a Family — VBS" };
export const dynamic = "force-dynamic";

type StopOption = {
  id: string;
  name: string;
  town: string;
  colorName: string;
  scheduledAm: string;
  scheduledPm: string;
};

export default async function SignupPage() {
  const admin = createAdminClient();
  const { data: stops } = await admin
    .from("stops")
    .select("id, name, town, color_name, scheduled_am_time, scheduled_pm_time")
    .order("sort_order");

  const stopOptions: StopOption[] = (stops ?? []).map(
    (s: { id: string; name: string; town: string; color_name: string; scheduled_am_time: string; scheduled_pm_time: string }) => ({
      id: s.id,
      name: s.name,
      town: s.town,
      colorName: s.color_name,
      scheduledAm: s.scheduled_am_time,
      scheduledPm: s.scheduled_pm_time,
    }),
  );

  const kinds: ConsentKind[] = [
    "media_release",
    "medical",
    "transport",
    "general_liability",
    "photo_release",
  ];
  const consents = await Promise.all(
    kinds.map(async (kind) => {
      const text = consentText(kind);
      const hash = await hashConsentText(text);
      return { kind, text, hash, version: CONSENT_VERSION };
    }),
  );
  void CONSENT_TEXT;  // silence unused-import noise from re-export consumers

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Register your family for VBS</h1>
        <p className="text-muted-foreground text-sm mt-1">
          One form per family. You can edit details later from your status link.
        </p>
      </header>
      <SignupForm stops={stopOptions} consents={consents} />
    </main>
  );
}

export type { StopOption };
