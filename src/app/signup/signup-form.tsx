"use client";

import { useState, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PhotoInput, type PhotoValue } from "@/components/photo-input";
import { toast } from "sonner";
import { registerFamily } from "@/server-actions/registration";
import type { ConsentKind, TransportMode } from "@/types/domain";
import Link from "next/link";

type StopOption = {
  id: string;
  name: string;
  town: string;
  colorName: string;
  scheduledAm: string;
  scheduledPm: string;
};

type ConsentItem = {
  kind: ConsentKind;
  text: string;
  hash: string;
  version: string;
};

type StudentDraft = {
  name: string;
  dob: string;
  age: string;
  allergies: string;
  medicalNotes: string;
  mode: TransportMode;
  morningStopId: string;
  afternoonStopId: string;
  photo: PhotoValue;
};

const emptyStudent = (): StudentDraft => ({
  name: "",
  dob: "",
  age: "",
  allergies: "",
  medicalNotes: "",
  mode: "van",
  morningStopId: "",
  afternoonStopId: "",
  photo: null,
});

const CONSENT_LABELS: Record<ConsentKind, string> = {
  media_release: "Media release",
  medical: "Emergency availability & medical",
  transport: "Transportation authorization",
  general_liability: "General liability",
  photo_release: "Wristband photo use",
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function SignupForm({
  stops,
  consents,
}: {
  stops: StopOption[];
  consents: ConsentItem[];
}) {
  const [family, setFamily] = useState({
    primaryGuardianName: "",
    primaryEmail: "",
    primaryPhone: "",
    streetAddress: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const [emergency, setEmergency] = useState({ name: "", phone: "", relationship: "" });
  const [students, setStudents] = useState<StudentDraft[]>([emptyStudent()]);
  const [agreedKinds, setAgreedKinds] = useState<Set<ConsentKind>>(new Set());
  const submittingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<
    null | {
      familyId: string;
      statusUrl: string;
      codes: { studentName: string; code: string }[];
    }
  >(null);

  function updateStudent(i: number, patch: Partial<StudentDraft>) {
    setStudents((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (agreedKinds.size !== consents.length) {
      toast.error("All consents must be agreed to before submitting.");
      return;
    }
    const missingDobAge = students.findIndex((s) => !s.dob && !s.age.trim());
    if (missingDobAge !== -1) {
      toast.error(`Enter date of birth or age for child #${missingDobAge + 1}.`);
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      const studentsPayload = await Promise.all(students.map(async (s) => ({
        name: s.name,
        dob: s.dob || null,
        ageAtRegistration: s.age.trim() ? Number(s.age) : null,
        grade: null,
        allergies: s.allergies || null,
        medicalNotes: s.medicalNotes || null,
        photoBytes: s.photo ? await blobToBase64(s.photo.blob) : null,
        transport: {
          mode: s.mode,
          morningStopId: s.mode === "van" || s.mode === "parent_pickup_only" ? s.morningStopId || null : null,
          afternoonStopId: s.mode === "van" || s.mode === "parent_dropoff_only" ? s.afternoonStopId || null : null,
        },
      })));

      const payload = {
        family,
        guardians: [
          {
            fullName: family.primaryGuardianName,
            email: family.primaryEmail,
            phone: family.primaryPhone,
            relationship: "Primary guardian",
          },
        ],
        emergencyContact:
          emergency.name.trim() && emergency.phone.trim() ? emergency : undefined,
        authorizedPickup: [],
        students: studentsPayload,
        consents: {
          agreed: consents.map((c) => ({
            kind: c.kind,
            textVersion: c.version,
            textHash: c.hash,
          })),
        },
      };

      const result = await registerFamily(payload);

      if (result.ok) {
        setSuccess({
          familyId: result.familyId,
          statusUrl: result.familyStatusUrl,
          codes: result.wristbandCodes,
        });
      } else {
        toast.error(result.error);
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-5 rounded-lg border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">You&apos;re registered.</h2>
          <p className="text-sm text-muted-foreground mt-1">
            We&apos;ve generated a wristband code for each child. Bring them on the
            first day of VBS — staff will scan or type these codes for check-in.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Wristband codes</h3>
          <ul className="rounded-lg border bg-muted/30 divide-y">
            {success.codes.map((c) => (
              <li key={c.code} className="flex justify-between items-center px-3 py-2 text-sm">
                <span className="truncate pr-2">{c.studentName}</span>
                <code className="font-mono tracking-widest shrink-0">{c.code}</code>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="text-sm font-medium">Your family status link</div>
          <p className="text-xs text-muted-foreground">
            Bookmark this link to see live updates during VBS — pickup, check-in,
            drop-off. No sign-in required from this device.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={success.statusUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 rounded border bg-background px-2 py-1.5 text-base sm:text-xs font-mono min-w-0 min-h-11 sm:min-h-8"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(success.statusUrl);
                toast.success("Copied");
              }}
            >
              Copy link
            </Button>
          </div>
          <Link
            href={success.statusUrl.replace(/^https?:\/\/[^/]+/, "")}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            Open status page now →
          </Link>
        </div>

        <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Done
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Your info</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" required>
            <Input required value={family.primaryGuardianName}
              onChange={(e) => setFamily({ ...family, primaryGuardianName: e.target.value })} />
          </Field>
          <Field label="Mobile phone" required>
            <Input required type="tel" autoComplete="tel" value={family.primaryPhone}
              onChange={(e) => setFamily({ ...family, primaryPhone: e.target.value })} />
          </Field>
        </div>
      </section>

      <details className="rounded-lg border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium min-h-11 flex items-center">
          Add email, address &amp; emergency contact (optional)
        </summary>
        <div className="mt-4 space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" value={family.primaryEmail}
              onChange={(e) => setFamily({ ...family, primaryEmail: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Street address">
              <Input value={family.streetAddress}
                onChange={(e) => setFamily({ ...family, streetAddress: e.target.value })} />
            </Field>
            <Field label="City">
              <Input value={family.city}
                onChange={(e) => setFamily({ ...family, city: e.target.value })} />
            </Field>
            <Field label="State">
              <Input value={family.state}
                onChange={(e) => setFamily({ ...family, state: e.target.value })} />
            </Field>
            <Field label="Postal code">
              <Input value={family.postalCode}
                onChange={(e) => setFamily({ ...family, postalCode: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-3">
            <div className="text-sm font-medium">Emergency contact</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name">
                <Input value={emergency.name}
                  onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input type="tel" value={emergency.phone}
                  onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} />
              </Field>
              <Field label="Relationship">
                <Input value={emergency.relationship}
                  onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })} />
              </Field>
            </div>
          </div>
        </div>
      </details>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Children</h2>
          <Button type="button" variant="outline" size="sm"
            onClick={() => setStudents([...students, emptyStudent()])}>+ Add child</Button>
        </div>
        {students.map((s, i) => (
          <fieldset key={i} className="rounded-lg border p-4 space-y-3 bg-card">
            <legend className="px-1 text-sm font-medium">Child #{i + 1}</legend>

            <Field label="Photo (optional)">
              <PhotoInput
                value={s.photo}
                onChange={(p) => updateStudent(i, { photo: p })}
              />
            </Field>

            <Field label="Child's name" required>
              <Input required value={s.name}
                onChange={(e) => updateStudent(i, { name: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date of birth">
                <Input type="date" value={s.dob}
                  onChange={(e) => updateStudent(i, { dob: e.target.value })} />
              </Field>
              <Field label="Age">
                <Input type="number" inputMode="numeric" min={1} max={18} value={s.age}
                  onChange={(e) => updateStudent(i, { age: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Enter date of birth or age — either one is fine.</p>
            <Field label="Allergies (one per line)">
              <Textarea value={s.allergies}
                onChange={(e) => updateStudent(i, { allergies: e.target.value })} />
            </Field>
            <Field label="Medical notes">
              <Textarea value={s.medicalNotes}
                onChange={(e) => updateStudent(i, { medicalNotes: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Transportation" required>
                <Select value={s.mode}
                  onChange={(e) => updateStudent(i, { mode: e.target.value as TransportMode })}>
                  <option value="van">Both ways by van</option>
                  <option value="parent_dropoff_only">Parent dropoff, van home</option>
                  <option value="parent_pickup_only">Van out, parent pickup</option>
                  <option value="parent_both">Parent both ways</option>
                </Select>
              </Field>
              {(s.mode === "van" || s.mode === "parent_pickup_only") && (
                <Field label="Morning stop" required>
                  <Select required value={s.morningStopId}
                    onChange={(e) => updateStudent(i, { morningStopId: e.target.value })}>
                    <option value="">— select —</option>
                    {stops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name} ({stop.town}, {stop.colorName} {stop.scheduledAm})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {(s.mode === "van" || s.mode === "parent_dropoff_only") && (
                <Field label="Afternoon stop" required>
                  <Select required value={s.afternoonStopId}
                    onChange={(e) => updateStudent(i, { afternoonStopId: e.target.value })}>
                    <option value="">— select —</option>
                    {stops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name} ({stop.town}, {stop.colorName} {stop.scheduledPm})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {students.length > 1 && (
              <Button type="button" variant="ghost" size="sm"
                onClick={() => setStudents((prev) => prev.filter((_, idx) => idx !== i))}>
                Remove this child
              </Button>
            )}
          </fieldset>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Consents</h2>
        <div className="space-y-3">
          {consents.map((c) => (
            <label key={c.kind} className="flex gap-3 items-start rounded border bg-card p-3">
              <Checkbox
                checked={agreedKinds.has(c.kind)}
                onCheckedChange={(checked: boolean) =>
                  setAgreedKinds((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(c.kind);
                    else next.delete(c.kind);
                    return next;
                  })
                }
                className="mt-0.5"
              />
              <span className="text-sm">
                <strong>{CONSENT_LABELS[c.kind]}</strong>
                <br />
                <span className="text-muted-foreground">{c.text}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          By submitting this form you agree to the items above on behalf of your family.
        </p>
      </section>

      <Button type="submit" disabled={pending} size="lg">
        {pending ? "Registering…" : "Register family"}
      </Button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}
