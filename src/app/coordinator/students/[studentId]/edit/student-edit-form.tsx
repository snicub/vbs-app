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
  updateStudentDayRecord,
  assignStudentToVan,
  updateStudentPhoto,
} from "@/server-actions/students";
import { SaveIcon, BusIcon, ImageIcon } from "lucide-react";

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

const RIDES_VAN = new Set(["van", "parent_dropoff_only", "parent_pickup_only"]);

export function StudentEditForm({
  studentId,
  eventDate,
  initialName,
  initialAllergies,
  initialMedicalNotes,
  initialDob,
  initialAge,
  currentPhotoUrl,
  initialMode,
  initialAttending,
  hasDayRecord,
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
  const [attending, setAttending] = useState(initialAttending);
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

  function savePlan() {
    startTransition(async () => {
      const result = await updateStudentDayRecord({ studentId, eventDate, mode, attending });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Today's plan saved");
      router.refresh();
    });
  }

  function assignVan() {
    if (!selectedVanId) {
      toast.error("Pick a van first");
      return;
    }
    startTransition(async () => {
      const result = await assignStudentToVan({ studentId, eventDate, vanId: selectedVanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Assigned to van");
      router.refresh();
    });
  }

  const ridesVan = RIDES_VAN.has(mode);
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

      {/* Today's plan section */}
      {hasDayRecord && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Today&apos;s plan ({eventDate})
          </h2>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="attending"
              checked={attending}
              onChange={(e) => setAttending(e.target.checked)}
              className="size-5 rounded accent-primary"
            />
            <Label htmlFor="attending">Attending today</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mode">Transport mode</Label>
            <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="van">Van (both ways)</option>
              <option value="parent_dropoff_only">Parent dropoff, van home</option>
              <option value="parent_pickup_only">Van to site, parent pickup</option>
              <option value="parent_both">Parent both ways</option>
            </Select>
          </div>

          <Button onClick={savePlan} disabled={pending}>
            <SaveIcon /> Save today&apos;s plan
          </Button>
        </section>
      )}

      {/* Van assignment section (door-to-door) */}
      {hasDayRecord && ridesVan && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Assign to a van
          </h2>

          <p className="text-sm text-muted-foreground">
            {currentVan ? (
              <>
                Currently on{" "}
                <span className="font-medium text-foreground">{currentVan.name}</span>
                {currentVan.zoneTown ? ` (${currentVan.zoneTown})` : ""}.
              </>
            ) : (
              <span className="text-[var(--anomaly-warn)]">
                Not on a van yet — pick one below.
              </span>
            )}
          </p>

          {vanOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No vans with a pickup zone are set up yet. Configure vans on the Vans screen.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="van">Van</Label>
                <Select
                  id="van"
                  value={selectedVanId}
                  onChange={(e) => setSelectedVanId(e.target.value)}
                >
                  <option value="">-- choose a van --</option>
                  {vanOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.zoneTown ? ` — ${v.zoneTown}` : ""}
                      {v.zoneColorName ? ` (${v.zoneColorName})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <Button onClick={assignVan} disabled={pending}>
                <BusIcon /> Assign to van
              </Button>
            </>
          )}
        </section>
      )}

      {!hasDayRecord && (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          No day record for {eventDate}. This student may not be registered for today.
        </div>
      )}
    </div>
  );
}
