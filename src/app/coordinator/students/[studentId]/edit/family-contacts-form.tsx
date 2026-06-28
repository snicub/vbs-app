"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  updateFamilyContacts,
  updateGuardianPhone,
} from "@/server-actions/families";
import { SaveIcon, PhoneIcon } from "lucide-react";

type Guardian = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
};

export function FamilyContactsForm({
  familyId,
  primaryGuardianId,
  initialPrimaryPhone,
  initialStreetAddress,
  initialCity,
  initialEmergencyContactName,
  initialEmergencyContactPhone,
  initialEmergencyContactRelationship,
  guardians,
  primaryGuardianName,
  primaryEmail,
}: {
  familyId: string;
  primaryGuardianId: string | null;
  initialPrimaryPhone: string;
  initialStreetAddress: string;
  initialCity: string;
  initialEmergencyContactName: string;
  initialEmergencyContactPhone: string;
  initialEmergencyContactRelationship: string;
  guardians: Guardian[];
  primaryGuardianName: string;
  primaryEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [guardianName, setGuardianName] = useState(primaryGuardianName);
  const [email, setEmail] = useState(primaryEmail);
  const [primaryPhone, setPrimaryPhone] = useState(initialPrimaryPhone);
  const [street, setStreet] = useState(initialStreetAddress);
  const [city, setCity] = useState(initialCity);
  const [ecName, setEcName] = useState(initialEmergencyContactName);
  const [ecPhone, setEcPhone] = useState(initialEmergencyContactPhone);
  const [ecRelationship, setEcRelationship] = useState(initialEmergencyContactRelationship);

  // Track per-guardian phone edits
  const [guardianPhones, setGuardianPhones] = useState<Record<string, string>>(
    Object.fromEntries(guardians.map((g) => [g.id, g.phone ?? ""])),
  );

  function saveFamilyContacts() {
    startTransition(async () => {
      const result = await updateFamilyContacts({
        familyId,
        primaryGuardianId: primaryGuardianId ?? undefined,
        primaryGuardianName: guardianName,
        primaryEmail: email,
        primaryPhone,
        streetAddress: street,
        city,
        emergencyContactName: ecName,
        emergencyContactPhone: ecPhone,
        emergencyContactRelationship: ecRelationship,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Family contacts saved");
      router.refresh();
    });
  }

  function saveGuardianPhone(guardianId: string, name: string) {
    const phone = guardianPhones[guardianId];
    if (!phone?.trim()) {
      toast.error("Phone number is required");
      return;
    }
    startTransition(async () => {
      const result = await updateGuardianPhone({
        guardianId,
        phone: phone.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name}'s phone updated`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Primary family contacts */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Family contacts
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="guardianName">Caregiver name</Label>
            <Input
              id="guardianName"
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="primaryEmail">Email</Label>
            <Input
              id="primaryEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="primaryPhone">Primary phone</Label>
          <Input
            id="primaryPhone"
            type="tel"
            value={primaryPhone}
            onChange={(e) => setPrimaryPhone(e.target.value)}
          />
        </div>

        <div className="border-t pt-3 mt-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
            Home address
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="street">Street address</Label>
              <Input
                id="street"
                autoComplete="street-address"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City / town</Label>
              <Input
                id="city"
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>
          {!street.trim() && !city.trim() ? (
            <p className="mt-1 text-xs text-[var(--anomaly-warn)]">
              No address on file — this child can&apos;t be routed to a van until one is added.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Changing the address re-routes this family on the next &ldquo;Suggest vans from addresses.&rdquo;
            </p>
          )}
        </div>

        <div className="border-t pt-3 mt-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
            Emergency contact
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ecName">Name</Label>
              <Input
                id="ecName"
                value={ecName}
                onChange={(e) => setEcName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ecPhone">Phone</Label>
              <Input
                id="ecPhone"
                type="tel"
                value={ecPhone}
                onChange={(e) => setEcPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ecRelationship">Relationship</Label>
              <Input
                id="ecRelationship"
                value={ecRelationship}
                onChange={(e) => setEcRelationship(e.target.value)}
                placeholder="e.g. grandma"
              />
            </div>
          </div>
        </div>

        <Button onClick={saveFamilyContacts} disabled={pending}>
          <SaveIcon /> Save family contacts
        </Button>
      </section>

      {/* Guardian phone numbers (editable individually) */}
      {guardians.length > 0 && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Guardian phone numbers
          </h2>
          {guardians.map((g) => (
            <div key={g.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>
                  {g.fullName}
                  {g.relationship && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({g.relationship})
                    </span>
                  )}
                </Label>
                <Input
                  type="tel"
                  value={guardianPhones[g.id] ?? ""}
                  onChange={(e) =>
                    setGuardianPhones((prev) => ({
                      ...prev,
                      [g.id]: e.target.value,
                    }))
                  }
                  placeholder="Phone number"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveGuardianPhone(g.id, g.fullName)}
                disabled={pending || (guardianPhones[g.id] ?? "") === (g.phone ?? "")}
              >
                <PhoneIcon /> Save
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
