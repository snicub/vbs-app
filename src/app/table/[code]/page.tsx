import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canCheckIn } from "@/lib/auth/roles";
import { lookupByWristband } from "@/server-actions/events";
import { signedUrlFor } from "@/lib/storage/signed-url";
import { StudentActions } from "./student-actions";
import { STATE_LABEL, type DayState } from "@/lib/events/state-machine";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StudentTablePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canCheckIn(user.role)) {
    return <main className="p-6 text-sm">Not permitted.</main>;
  }

  const result = await lookupByWristband({ code });
  if (!result.ok) notFound();

  const { student, status } = result;
  const state = (status?.state ?? "not_started") as DayState;
  const photoUrl = await signedUrlFor("student-photos", student.photoPath);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-5">
      <Link href="/table" className="text-sm text-muted-foreground hover:underline">
        ← Back to search
      </Link>

      <div className="flex items-start gap-4">
        <div className="h-24 w-24 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={student.legalFirstName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground text-center">No photo on file</span>
          )}
        </div>
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">
            {student.preferredFirstName ?? student.legalFirstName} {student.legalLastName}
          </h1>
          <div className="text-sm text-muted-foreground">
            <code className="font-mono">{student.wristbandCode}</code>
            {status?.wristbandColorName && <> · color {status.wristbandColorName}</>}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          Current status
        </div>
        <div className="mt-1 text-lg font-semibold">{STATE_LABEL[state]}</div>
      </div>

      {(student.allergies || student.medicalNotes) && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-50 p-3 text-sm space-y-2 dark:bg-yellow-900/20">
          {student.allergies && (
            <p><strong>Allergies:</strong> {student.allergies}</p>
          )}
          {student.medicalNotes && (
            <p><strong>Medical:</strong> {student.medicalNotes}</p>
          )}
        </div>
      )}

      <StudentActions
        studentId={student.id}
        eventDate={status?.eventDate ?? new Date().toISOString().slice(0, 10)}
        currentState={state}
        actorRole={user.role}
      />
    </main>
  );
}
