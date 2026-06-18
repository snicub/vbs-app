import { SignupForm } from "./signup/signup-form";
import { consentText, CONSENT_TEXT, CONSENT_VERSION } from "@/lib/consents/text";
import { hashConsentText } from "@/lib/consents/hash";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register your family — VBS" };

// The homepage IS the family registration form. Families never sign in — this
// is a public link; staff reach their screens at /coordinator, /van, /table.
export default async function Home() {
  const kinds = Object.keys(
    CONSENT_TEXT[CONSENT_VERSION],
  ) as (keyof (typeof CONSENT_TEXT)[typeof CONSENT_VERSION])[];
  const consents = await Promise.all(
    kinds.map(async (kind) => {
      const text = consentText(kind);
      const hash = await hashConsentText(text);
      return { kind, text, hash, version: CONSENT_VERSION };
    }),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">South Dakota Vacation Bible School 2026: Better Together</h1>
      </header>
      <SignupForm consents={consents} />
    </main>
  );
}
