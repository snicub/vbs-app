"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
  legalFirstName: string;
  legalLastName: string;
  preferredFirstName: string;
  dob: string;
  allergies: string;
  medicalNotes: string;
  mode: TransportMode;
  morningStopId: string;
  afternoonStopId: string;
};

const emptyStudent = (): StudentDraft => ({
  legalFirstName: "",
  legalLastName: "",
  preferredFirstName: "",
  dob: "",
  allergies: "",
  medicalNotes: "",
  mode: "van",
  morningStopId: "",
  afternoonStopId: "",
});

const CONSENT_LABELS: Record<ConsentKind, string> = {
  media_release: "Media release",
  medical: "Medical authorization",
  transport: "Transportation authorization",
  general_liability: "General liability",
  photo_release: "Wristband photo use",
};

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
  const [typedName, setTypedName] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<
    null | { familyId: string; codes: { studentName: string; code: string }[] }
  >(null);

  function updateStudent(i: number, patch: Partial<StudentDraft>) {
    setStudents((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (agreedKinds.size !== consents.length) {
      toast.error("All consents must be agreed to before submitting.");
      return;
    }
    if (typedName.trim().length === 0) {
      toast.error("Type your full name to sign.");
      return;
    }

    setPending(true);
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
      emergencyContact: emergency,
      authorizedPickup: [],
      students: students.map((s) => ({
        legalFirstName: s.legalFirstName,
        legalLastName: s.legalLastName,
        preferredFirstName: s.preferredFirstName || null,
        dob: s.dob || null,
        ageAtRegistration: null,
        grade: null,
        allergies: s.allergies || null,
        medicalNotes: s.medicalNotes || null,
        transport: {
          mode: s.mode,
          morningStopId: s.mode === "van" || s.mode === "parent_pickup_only" ? s.morningStopId || null : null,
          afternoonStopId: s.mode === "van" || s.mode === "parent_dropoff_only" ? s.afternoonStopId || null : null,
        },
      })),
      consents: {
        typedName,
        agreed: consents.map((c) => ({
          kind: c.kind,
          textVersion: c.version,
          textHash: c.hash,
        })),
      },
    };

    const result = await registerFamily(payload);
    setPending(false);

    if (result.ok) {
      setSuccess({ familyId: result.familyId, codes: result.wristbandCodes });
    } else {
      toast.error(result.error);
    }
  }

  if (success) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">You&apos;re registered.</h2>
        <p className="text-sm">
          We&apos;ve generated a wristband code for each child. Bring them on the first
          day of VBS — staff will scan or type these codes for check-in.
        </p>
        <ul className="rounded border bg-muted/30 divide-y">
          {success.codes.map((c) => (
            <li key={c.code} className="flex justify-between px-3 py-2 text-sm">
              <span>{c.studentName}</span>
              <code className="font-mono tracking-widest">{c.code}</code>
            </li>
          ))}
        </ul>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Done
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* ------------------- Family ------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Primary guardian</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input
              required
              value={family.primaryGuardianName}
              onChange={(e) => setFamily({ ...family, primaryGuardianName: e.target.value })}
            />
          </Field>
          <Field label="Email" required>
            <Input
              required
              type="email"
              autoComplete="email"
              value={family.primaryEmail}
              onChange={(e) => setFamily({ ...family, primaryEmail: e.target.value })}
            />
          </Field>
          <Field label="Phone" required>
            <Input
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={family.primaryPhone}
              onChange={(e) => setFamily({ ...family, primaryPhone: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Street address">
            <Input
              value={family.streetAddress}
              onChange={(e) => setFamily({ ...family, streetAddress: e.target.value })}
            />
          </Field>
          <Field label="City">
            <Input
              value={family.city}
              onChange={(e) => setFamily({ ...family, city: e.target.value })}
            />
          </Field>
          <Field label="State">
            <Input
              value={family.state}
              onChange={(e) => setFamily({ ...family, state: e.target.value })}
            />
          </Field>
          <Field label="Postal code">
            <Input
              value={family.postalCode}
              onChange={(e) => setFamily({ ...family, postalCode: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* ------------------- Emergency ------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Emergency contact</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" required>
            <Input
              required
              value={emergency.name}
              onChange={(e) => setEmergency({ ...emergency, name: e.target.value })}
            />
          </Field>
          <Field label="Phone" required>
            <Input
              required
              type="tel"
              value={emergency.phone}
              onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })}
            />
          </Field>
          <Field label="Relationship" required>
            <Input
              required
              value={emergency.relationship}
              onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* ------------------- Children ------------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Children</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStudents([...students, emptyStudent()])}
          >
            + Add child
          </Button>
        </div>
        {students.map((s, i) => (
          <fieldset
            key={i}
            className="rounded-lg border p-4 space-y-3 bg-card"
          >
            <legend className="px-1 text-sm font-medium">Child #{i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal first name" required>
                <Input
                  required
                  value={s.legalFirstName}
                  onChange={(e) => updateStudent(i, { legalFirstName: e.target.value })}
                />
              </Field>
              <Field label="Legal last name" required>
                <Input
                  required
                  value={s.legalLastName}
                  onChange={(e) => updateStudent(i, { legalLastName: e.target.value })}
                />
              </Field>
              <Field label="Preferred first name (optional)">
                <Input
                  value={s.preferredFirstName}
                  onChange={(e) => updateStudent(i, { preferredFirstName: e.target.value })}
                />
              </Field>
              <Field label="Date of birth" required>
                <Input
                  type="date"
                  required
                  value={s.dob}
                  onChange={(e) => updateStudent(i, { dob: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Allergies (one per line)">
              <Textarea
                value={s.allergies}
                onChange={(e) => updateStudent(i, { allergies: e.target.value })}
              />
            </Field>
            <Field label="Medical notes">
              <Textarea
                value={s.medicalNotes}
                onChange={(e) => updateStudent(i, { medicalNotes: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Transportation" required>
                <Select
                  value={s.mode}
                  onChange={(e) => updateStudent(i, { mode: e.target.value as TransportMode })}
                >
                  <option value="van">Both ways by van</option>
                  <option value="parent_dropoff_only">Parent dropoff, van home</option>
                  <option value="parent_pickup_only">Van out, parent pickup</option>
                  <option value="parent_both">Parent both ways</option>
                </Select>
              </Field>
              {(s.mode === "van" || s.mode === "parent_pickup_only") && (
                <Field label="Morning stop" required>
                  <Select
                    required
                    value={s.morningStopId}
                    onChange={(e) => updateStudent(i, { morningStopId: e.target.value })}
                  >
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
                  <Select
                    required
                    value={s.afternoonStopId}
                    onChange={(e) => updateStudent(i, { afternoonStopId: e.target.value })}
                  >
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setStudents((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                Remove this child
              </Button>
            )}
          </fieldset>
        ))}
      </section>

      {/* ------------------- Consents ------------------- */}
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
        <Field label="Type your full legal name to sign" required>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            required
          />
        </Field>
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
