"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { updateStudent, updateStudentDayRecord } from "@/server-actions/students";
import { SaveIcon } from "lucide-react";

type StopOption = {
  id: string;
  name: string;
  town: string;
  colorName: string;
};

export function StudentEditForm({
  studentId,
  eventDate,
  initialPreferredFirstName,
  initialAllergies,
  initialMedicalNotes,
  initialMode,
  initialMorningStopId,
  initialAfternoonStopId,
  initialAttending,
  hasDayRecord,
  stops,
}: {
  studentId: string;
  eventDate: string;
  initialPreferredFirstName: string;
  initialAllergies: string;
  initialMedicalNotes: string;
  initialMode: string | null;
  initialMorningStopId: string | null;
  initialAfternoonStopId: string | null;
  initialAttending: boolean;
  hasDayRecord: boolean;
  stops: StopOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [preferredFirstName, setPreferredFirstName] = useState(initialPreferredFirstName);
  const [allergies, setAllergies] = useState(initialAllergies);
  const [medicalNotes, setMedicalNotes] = useState(initialMedicalNotes);

  const [mode, setMode] = useState(initialMode ?? "van");
  const [morningStopId, setMorningStopId] = useState(initialMorningStopId ?? "");
  const [afternoonStopId, setAfternoonStopId] = useState(initialAfternoonStopId ?? "");
  const [attending, setAttending] = useState(initialAttending);

  function saveProfile() {
    startTransition(async () => {
      const result = await updateStudent({
        studentId,
        preferredFirstName,
        allergies,
        medicalNotes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Student info saved");
      router.refresh();
    });
  }

  function saveDayRecord() {
    startTransition(async () => {
      const result = await updateStudentDayRecord({
        studentId,
        eventDate,
        mode,
        morningStopId: morningStopId || null,
        afternoonStopId: afternoonStopId || null,
        attending,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Today's plan saved");
      router.refresh();
    });
  }

  const needsAmStop = mode === "van" || mode === "parent_pickup_only";
  const needsPmStop = mode === "van" || mode === "parent_dropoff_only";

  return (
    <div className="space-y-6">
      {/* Student profile section */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Student info
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="preferredFirstName">Preferred first name</Label>
          <Input
            id="preferredFirstName"
            value={preferredFirstName}
            onChange={(e) => setPreferredFirstName(e.target.value)}
            placeholder="Leave blank to use legal name"
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
            <Select
              id="mode"
              value={mode}
              onChange={(e) => {
                const m = e.target.value;
                setMode(m);
                if (m === "parent_both" || m === "parent_dropoff_only") setMorningStopId("");
                if (m === "parent_both" || m === "parent_pickup_only") setAfternoonStopId("");
              }}
            >
              <option value="van">Van (both ways)</option>
              <option value="parent_dropoff_only">Parent dropoff, van home</option>
              <option value="parent_pickup_only">Van to site, parent pickup</option>
              <option value="parent_both">Parent both ways</option>
            </Select>
          </div>

          {needsAmStop && (
            <div className="space-y-1.5">
              <Label htmlFor="morningStop">Morning pickup stop</Label>
              <Select
                id="morningStop"
                value={morningStopId}
                onChange={(e) => setMorningStopId(e.target.value)}
              >
                <option value="">-- none --</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.town}, {s.colorName})
                  </option>
                ))}
              </Select>
            </div>
          )}

          {needsPmStop && (
            <div className="space-y-1.5">
              <Label htmlFor="afternoonStop">Afternoon drop-off stop</Label>
              <Select
                id="afternoonStop"
                value={afternoonStopId}
                onChange={(e) => setAfternoonStopId(e.target.value)}
              >
                <option value="">-- none --</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.town}, {s.colorName})
                  </option>
                ))}
              </Select>
            </div>
          )}

          <Button onClick={saveDayRecord} disabled={pending}>
            <SaveIcon /> Save today&apos;s plan
          </Button>
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
