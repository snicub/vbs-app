"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PhotoInput, type PhotoValue } from "@/components/photo-input";
import { ageFromDob } from "@/lib/registration/age";
import { toast } from "sonner";
import {
  updateStudent,
  updateStudentModeAllDays,
  assignStudentToVanAllDays,
  updateStudentPhoto,
} from "@/server-actions/students";
import { SaveIcon, ImageIcon } from "lucide-react";

type VanOption = {
  id: string;
  name: string;
  zoneTown: string | null;
  zoneColorName: string | null;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function StudentEditForm({
  studentId,
  initialName,
  initialAllergies,
  initialMedicalNotes,
  initialDob,
  initialAge,
  currentPhotoUrl,
  initialMode,
  vanOptions,
  currentVanId,
}: {
  studentId: string;
  eventDate: string;
  initialName: string;
  initialAllergies: string;
  initialMedicalNotes: string;
  initialDob: string;
  initialAge: string;
  currentPhotoUrl: string | null;
  initialMode: string | null;
  initialAttending: boolean;
  hasDayRecord: boolean;
  vanOptions: VanOption[];
  currentVanId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initialName);
  const [allergies, setAllergies] = useState(initialAllergies);
  const [medicalNotes, setMedicalNotes] = useState(initialMedicalNotes);
  const [dob, setDob] = useState(initialDob);
  const [age, setAge] = useState(initialAge);

  const [newPhoto, setNewPhoto] = useState<PhotoValue>(null);
  const [photoPending, startPhotoTransition] = useTransition();

  const [mode, setMode] = useState(initialMode ?? "van");
  const [selectedVanId, setSelectedVanId] = useState(currentVanId ?? "");

  function onDobChange(value: string) {
    setDob(value);
    // Local calendar date (en-CA → YYYY-MM-DD), not UTC — near midnight a UTC
    // date can be a day ahead and mis-derive the age by a year.
    const derived = ageFromDob(value, new Date().toLocaleDateString("en-CA"));
    if (derived != null) setAge(String(derived));
  }

  function saveProfile() {
    if (!dob && !age.trim()) {
      toast.error("Enter a date of birth or an age.");
      return;
    }
    startTransition(async () => {
      const result = await updateStudent({
        studentId,
        name,
        allergies,
        medicalNotes,
        dob: dob || null,
        ageAtRegistration: age.trim() ? Number(age) : null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Student info saved");
      router.refresh();
    });
  }

  function savePhoto() {
    if (!newPhoto) return;
    startPhotoTransition(async () => {
      const photoBytes = await blobToBase64(newPhoto.blob);
      const result = await updateStudentPhoto({ studentId, photoBytes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Photo updated");
      setNewPhoto(null);
      router.refresh();
    });
  }

  function saveMode() {
    startTransition(async () => {
      const result = await updateStudentModeAllDays({ studentId, mode });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Transport mode saved (all VBS days)");
      router.refresh();
    });
  }

  // Saves the moment a region is picked — no separate button to forget.
  function assignRegion(vanId: string) {
    setSelectedVanId(vanId);
    if (!vanId) return;
    startTransition(async () => {
      const result = await assignStudentToVanAllDays({ studentId, vanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Assigned to region (all VBS days)");
      router.refresh();
    });
  }

  const currentVan = vanOptions.find((v) => v.id === currentVanId) ?? null;

  return (
    <div className="space-y-6">
      {/* Student profile section */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Student info
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Child's name"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => onDobChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="age">Age</Label>
            <Input
              id="age"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Date of birth or age — either one is fine.</p>

        <div className="space-y-1.5">
          <Label htmlFor="allergies">
            Allergies <span className="text-[var(--allergy)] font-normal">(safety-critical)</span>
          </Label>
          <Textarea
            id="allergies"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            placeholder="None known"
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="medicalNotes">
            Medical notes <span className="text-[var(--medical)] font-normal">(safety-critical)</span>
          </Label>
          <Textarea
            id="medicalNotes"
            value={medicalNotes}
            onChange={(e) => setMedicalNotes(e.target.value)}
            placeholder="None"
            rows={2}
          />
        </div>

        <Button onClick={saveProfile} disabled={pending}>
          <SaveIcon /> Save student info
        </Button>

        <div className="border-t pt-4 space-y-2">
          <Label>Photo</Label>
          <div className="flex items-start gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted flex items-center justify-center">
              {currentPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentPhotoUrl} alt="Current photo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">No photo</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-xs text-muted-foreground">
                {currentPhotoUrl ? "Current photo. Choose a new one to replace it." : "No photo on file. Add one below."}
              </p>
              <PhotoInput value={newPhoto} onChange={setNewPhoto} />
              {newPhoto && (
                <Button onClick={savePhoto} disabled={photoPending} size="sm">
                  <ImageIcon /> {photoPending ? "Saving…" : "Save photo"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Transport & region — applies to ALL VBS days (door-to-door) */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Transport &amp; region
          <span className="ml-2 normal-case font-normal text-muted-foreground/80">
            (applies to every VBS day)
          </span>
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="mode">How they get to &amp; from VBS</Label>
          <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="van">Van both ways</option>
            <option value="parent_dropoff_only">Parent drops off, van home</option>
            <option value="parent_pickup_only">Van to site, parent picks up</option>
            <option value="parent_both">Parent both ways (no van)</option>
          </Select>
          <Button onClick={saveMode} disabled={pending} className="mt-2">
            <SaveIcon /> Save transport mode
          </Button>
        </div>

        {mode !== "parent_both" && (
          <div className="space-y-1.5 border-t pt-4">
            <Label htmlFor="van">Region (van)</Label>
            <p className="text-sm text-muted-foreground">
              {currentVan ? (
                <>
                  Currently on{" "}
                  <span className="font-medium text-foreground">{currentVan.name}</span>
                  {currentVan.zoneColorName ? ` (${currentVan.zoneColorName})` : ""}.
                </>
              ) : (
                <span className="text-[var(--anomaly-warn)]">
                  Not on a van yet — save the mode above, then pick a region.
                </span>
              )}
            </p>

            {vanOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No vans with a pickup zone yet — set them up on the Vans screen.
              </p>
            ) : (
              <>
                <Select
                  id="van"
                  value={selectedVanId}
                  disabled={pending}
                  onChange={(e) => assignRegion(e.target.value)}
                >
                  <option value="">-- choose a region --</option>
                  {vanOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.zoneColorName ? ` (${v.zoneColorName})` : ""}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {pending ? "Saving…" : "Saves the moment you pick — applies to all 3 days."}
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
