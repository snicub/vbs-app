"use client";

import { useState, useRef, useId, cloneElement, isValidElement } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PhotoInput, type PhotoValue } from "@/components/photo-input";
import { clientId } from "@/lib/offline/uuid";
import { ageFromDob } from "@/lib/registration/age";
import { toast } from "sonner";
import { registerFamily } from "@/server-actions/registration";
import type { ConsentKind } from "@/types/domain";
import Link from "next/link";
import { Trash2Icon } from "lucide-react";

type ConsentItem = {
  kind: ConsentKind;
  text: string;
  hash: string;
  version: string;
};

type StudentDraft = {
  // Stable id so list keys survive removing a middle child — an index key would
  // otherwise re-pair a child's photo/state onto the wrong sibling's fieldset.
  id: string;
  name: string;
  dob: string;
  age: string;
  medicalNotes: string;
  ridesVan: boolean;
  photo: PhotoValue;
};

const emptyStudent = (): StudentDraft => ({
  id: clientId(),
  name: "",
  dob: "",
  age: "",
  medicalNotes: "",
  ridesVan: true,
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
  consents,
  regions,
}: {
  consents: ConsentItem[];
  regions: { stopId: string; name: string }[];
}) {
  const [regionStopId, setRegionStopId] = useState("");
  const [family, setFamily] = useState({
    primaryGuardianName: "",
    primaryEmail: "",
    primaryPhone: "",
    streetAddress: "",
    city: "",
    // The event is in Sisseton, SD — state is constant, so we don't ask for it
    // (or ZIP). Hard-set so route-building still has a state to geocode against.
    state: "SD",
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

  const needsVan = students.some((s) => s.ridesVan);

  function updateStudent(i: number, patch: Partial<StudentDraft>) {
    setStudents((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function onDobChange(i: number, dob: string) {
    const patch: Partial<StudentDraft> = { dob };
    const derived = ageFromDob(dob, new Date().toISOString().slice(0, 10));
    if (derived != null) patch.age = String(derived);
    updateStudent(i, patch);
  }

  function removeStudent(i: number) {
    setStudents((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (agreedKinds.size !== consents.length) {
      toast.error("Please agree to all the items at the bottom before submitting.");
      return;
    }
    const missingDobAge = students.findIndex((s) => !s.dob && !s.age.trim());
    if (missingDobAge !== -1) {
      toast.error(`Enter a date of birth or age for child #${missingDobAge + 1}.`);
      return;
    }
    if (needsVan && (!family.streetAddress.trim() || !family.city.trim())) {
      toast.error("Please add your home street address and town so we can plan the van ride.");
      return;
    }
    if (needsVan && regions.length > 0 && !regionStopId) {
      toast.error("Please pick your pickup region for the van.");
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      const studentsPayload = await Promise.all(
        students.map(async (s) => ({
          name: s.name,
          dob: s.dob || null,
          ageAtRegistration: s.age.trim() ? Number(s.age) : null,
          grade: null,
          allergies: null,
          medicalNotes: s.medicalNotes || null,
          photoBytes: s.photo ? await blobToBase64(s.photo.blob) : null,
          transport: {
            mode: s.ridesVan ? "van" : "parent_both",
            regionStopId: s.ridesVan && regionStopId ? regionStopId : null,
          },
        })),
      );

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
    } catch {
      // A thrown (vs. returned) error means the request never completed —
      // a dropped connection in a weak-signal driveway, or a payload the
      // server rejected before our code ran (e.g. photos over the size limit).
      // Tell the family to retry; their entries are still on screen.
      toast.error(
        "Couldn't reach the server — check your signal and tap Register again. Your info is still here.",
      );
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-6 rounded-lg border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--state-safe)]/15 text-[var(--state-safe)] text-xl"
          >
            ✓
          </div>
          <div>
            <h2 className="text-2xl font-semibold">You&apos;re all set!</h2>
            <p className="text-base text-muted-foreground mt-1">
              {success.codes.length === 1 ? "Your child is" : "Your children are"} registered for VBS.
            </p>
          </div>
        </div>

        {success.codes.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Checking them in now? Tap their name:</p>
            {success.codes.map((c) => (
              <Link
                key={c.code}
                href={`/table/${c.code}`}
                className={buttonVariants({ variant: "default" }) + " w-full justify-start text-base"}
              >
                Check in {c.studentName}
              </Link>
            ))}
          </div>
        )}

        <Link href="/" className={buttonVariants({ variant: "ghost" })}>
          Register another
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">Caregiver&apos;s info</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" required>
            <Input
              required
              autoComplete="name"
              value={family.primaryGuardianName}
              onChange={(e) => setFamily({ ...family, primaryGuardianName: e.target.value })}
            />
          </Field>
          <Field label="Mobile phone" required>
            <Input
              required
              type="tel"
              autoComplete="tel"
              value={family.primaryPhone}
              onChange={(e) => setFamily({ ...family, primaryPhone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={family.primaryEmail}
            onChange={(e) => setFamily({ ...family, primaryEmail: e.target.value })}
          />
        </Field>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Children</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => setStudents([...students, emptyStudent()])}
          >
            + Add child
          </Button>
        </div>
        {students.map((s, i) => (
          <fieldset key={s.id} className="rounded-xl border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-medium">Child #{i + 1}</span>
              {students.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeStudent(i)}
                >
                  <Trash2Icon className="size-4" />
                  Remove
                </Button>
              )}
            </div>

            <Field label="Photo">
              <PhotoInput value={s.photo} onChange={(p) => updateStudent(i, { photo: p })} />
            </Field>

            <Field label="Child's name" required>
              <Input
                required
                value={s.name}
                onChange={(e) => updateStudent(i, { name: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date of birth">
                <Input
                  type="date"
                  value={s.dob}
                  onChange={(e) => onDobChange(i, e.target.value)}
                />
              </Field>
              <Field label="Age">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={s.age}
                  onChange={(e) => updateStudent(i, { age: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              Date of birth or age — either one is fine.
            </p>

            <div className="space-y-2">
              <Label className="text-base">VBS van</Label>
              <label className="flex items-start gap-3 rounded-lg border bg-card p-3 min-h-12 cursor-pointer">
                <Checkbox
                  checked={s.ridesVan}
                  onCheckedChange={(c: boolean) => updateStudent(i, { ridesVan: c })}
                  className="mt-0.5"
                />
                <span className="text-base">
                  My child will ride the VBS van
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                    Leave unchecked if you&apos;ll drive them yourself. We&apos;ll sort out
                    morning vs. afternoon pickup with you.
                  </span>
                </span>
              </label>
            </div>

            <Field label="Allergies & medical notes">
              <Textarea
                value={s.medicalNotes}
                onChange={(e) => updateStudent(i, { medicalNotes: e.target.value })}
                placeholder="Anything staff should know — allergies, medications, conditions"
              />
            </Field>

          </fieldset>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">
            Home address
            {needsVan && <span className="text-destructive ml-0.5">*</span>}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {needsVan
              ? "We use your address to plan your child's van pickup and the ride home."
              : "Optional — you're driving your child, so we don't need it for routing."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Street address" required={needsVan}>
            <Input
              autoComplete="street-address"
              required={needsVan}
              value={family.streetAddress}
              onChange={(e) => setFamily({ ...family, streetAddress: e.target.value })}
            />
          </Field>
          <Field label="City" required={needsVan}>
            <Input
              required={needsVan}
              autoComplete="address-level2"
              value={family.city}
              onChange={(e) => setFamily({ ...family, city: e.target.value })}
            />
          </Field>
        </div>
        {needsVan && regions.length > 0 && (
          <Field label="Pickup region" required>
            <Select value={regionStopId} onChange={(e) => setRegionStopId(e.target.value)}>
              <option value="">-- Pick your region --</option>
              {regions.map((r) => (
                <option key={r.stopId} value={r.stopId}>
                  {r.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick the region/town your child is picked up from — this puts them straight on the
              right van.
            </p>
          </Field>
        )}
      </section>

      <details className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-base font-medium min-h-11 flex items-center">
          Add emergency contact (optional)
        </summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-3">
            <div className="text-base font-medium">Emergency contact</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name">
                <Input
                  value={emergency.name}
                  onChange={(e) => setEmergency({ ...emergency, name: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={emergency.phone}
                  onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })}
                />
              </Field>
              <Field label="Relationship">
                <Input
                  value={emergency.relationship}
                  onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      </details>

      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">Please agree to the following</h2>
        <label className="flex gap-3 items-center rounded-lg border-2 border-primary/40 bg-primary/5 p-3 min-h-12">
          <Checkbox
            checked={consents.length > 0 && agreedKinds.size === consents.length}
            onCheckedChange={(checked: boolean) =>
              setAgreedKinds(checked ? new Set(consents.map((c) => c.kind)) : new Set())
            }
          />
          <span className="text-base font-semibold">Agree to all</span>
        </label>
        <div className="space-y-3">
          {consents.map((c) => (
            <label key={c.kind} className="flex gap-3 items-start rounded-lg border bg-muted/30 p-3">
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
                <strong className="text-base">{CONSENT_LABELS[c.kind]}</strong>
                <br />
                <span className="text-muted-foreground">{c.text}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          By submitting, you agree to the items above on behalf of your family.
        </p>
      </section>

      <Button type="submit" disabled={pending} size="lg" className="w-full sm:w-auto">
        {pending ? "Registering…" : "Register my family"}
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
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}
