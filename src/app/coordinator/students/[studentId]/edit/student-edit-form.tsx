"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  updateStudent,
  updateStudentDayRecord,
  assignStudentToVan,
} from "@/server-actions/students";
import { SaveIcon, BusIcon } from "lucide-react";

type VanOption = {
  id: string;
  name: string;
  zoneTown: string | null;
  zoneColorName: string | null;
};

const RIDES_VAN = new Set(["van", "parent_dropoff_only", "parent_pickup_only"]);

export function StudentEditForm({
  studentId,
  eventDate,
  initialName,
  initialAllergies,
  initialMedicalNotes,
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

  const [mode, setMode] = useState(initialMode ?? "van");
  const [attending, setAttending] = useState(initialAttending);
  const [selectedVanId, setSelectedVanId] = useState(currentVanId ?? "");

  function saveProfile() {
    startTransition(async () => {
      const result = await updateStudent({ studentId, name, allergies, medicalNotes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Student info saved");
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
