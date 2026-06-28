"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contrastText } from "@/lib/nametags/tag-data";
import type { VanManifest, RosterEntry } from "@/lib/failsafe/print-data";

export function PrintFailsafe({
  date,
  manifests,
  roster,
}: {
  date: string;
  manifests: VanManifest[];
  roster: RosterEntry[];
}) {
  const router = useRouter();
  const needsRouting = roster.filter((r) => r.needsRouting);
  const totalRiders = manifests.reduce((n, v) => n + v.riders.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-3 sm:px-4 py-4 sm:py-6">
      <div className="print:hidden space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Print / Failsafe — {formatDate(date)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Sunday-night paper backup. Prints each van&apos;s rider list (one van per
            page) followed by the master roster. Staff-only — includes contacts
            and medical notes. Print it the night before and keep it in the van.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) =>
                router.push(`/coordinator/print?date=${e.target.value}`)
              }
              className="w-auto"
            />
          </label>
          <Button onClick={() => window.print()} className="ml-auto">
            Print failsafe
          </Button>
        </div>

        <div className="rounded-lg border bg-card p-3 text-sm space-y-1">
          <p>
            <strong>{manifests.length}</strong> active van
            {manifests.length === 1 ? "" : "s"} ·{" "}
            <strong>{totalRiders}</strong> van rider-slot
            {totalRiders === 1 ? "" : "s"} ·{" "}
            <strong>{roster.length}</strong> attending kid
            {roster.length === 1 ? "" : "s"} on the roster.
          </p>
          {needsRouting.length > 0 && (
            <p className="text-[var(--anomaly-critical)] font-medium">
              {needsRouting.length} kid{needsRouting.length === 1 ? "" : "s"}{" "}
              expected on a van but not assigned to one yet — they appear under
              &ldquo;No van / needs routing&rdquo; on the roster. Assign them to a
              van before printing.
            </p>
          )}
        </div>
      </div>

      <div className="failsafe-print">
        {/* ----- Per-van manifests, one van per printed page ----- */}
        {manifests.map((van) => (
          <section key={van.vanId} className="failsafe-page mt-8 first:mt-4 print:mt-0">
            <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-gray-800 pb-1">
              <h2 className="text-lg font-bold text-gray-900">
                {van.vanName} — rider list
              </h2>
              <span className="text-sm text-gray-700">
                {formatDate(date)} · {van.riders.length} rider
                {van.riders.length === 1 ? "" : "s"}
              </span>
            </header>
            {van.riders.length === 0 ? (
              <p className="text-sm text-gray-600">No riders assigned to this van.</p>
            ) : (
              <table className="w-full border-collapse text-sm text-gray-900">
                <thead>
                  <tr className="border-b border-gray-400 text-left align-bottom">
                    <th className="py-1 pr-2 font-semibold">Name</th>
                    <th className="py-1 pr-2 font-semibold">Pickup address</th>
                    <th className="py-1 pr-2 font-semibold">Code</th>
                    <th className="py-1 pr-2 font-semibold">When</th>
                    <th className="py-1 pr-2 font-semibold">Stop</th>
                    <th className="py-1 pr-2 font-semibold">Guardian phone</th>
                    <th className="py-1 font-semibold">Allergies / medical</th>
                  </tr>
                </thead>
                <tbody>
                  {van.riders.map((r) => (
                    <tr
                      key={`${r.studentId}-${r.direction}`}
                      className="border-b border-gray-200 align-top [break-inside:avoid]"
                    >
                      <td className="py-1 pr-2 font-medium">{r.name}</td>
                      <td className="py-1 pr-2">
                        {r.address ? (
                          r.address
                        ) : (
                          <span className="text-[var(--anomaly-warn)] font-medium">
                            — no address —
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2 font-mono tracking-wide">
                        {r.wristbandCode}
                      </td>
                      <td className="py-1 pr-2 uppercase">{r.direction}</td>
                      <td className="py-1 pr-2">
                        <span className="inline-flex items-center gap-1.5">
                          <ColorSwatch hex={r.colorCode} />
                          <span>
                            {r.stopName ?? "—"}
                            {r.colorName ? ` (${r.colorName})` : ""}
                          </span>
                        </span>
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {r.guardianPhone || "—"}
                      </td>
                      <td className="py-1">
                        <MedicalCell allergies={r.allergies} medical={r.medicalNotes} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}

        {/* ----- Master roster, starts on its own page ----- */}
        <section className="failsafe-page mt-8 print:mt-0">
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-gray-800 pb-1">
            <h2 className="text-lg font-bold text-gray-900">
              Master roster — every kid
            </h2>
            <span className="text-sm text-gray-700">
              {formatDate(date)} · {roster.length} attending
            </span>
          </header>
          {roster.length === 0 ? (
            <p className="text-sm text-gray-600">No attending kids for this date.</p>
          ) : (
            <table className="w-full border-collapse text-sm text-gray-900">
              <thead>
                <tr className="border-b border-gray-400 text-left align-bottom">
                  <th className="py-1 pr-2 font-semibold">Name</th>
                  <th className="py-1 pr-2 font-semibold">Code</th>
                  <th className="py-1 pr-2 font-semibold">Age</th>
                  <th className="py-1 pr-2 font-semibold">Van / stop</th>
                  <th className="py-1 pr-2 font-semibold">Guardian</th>
                  <th className="py-1 pr-2 font-semibold">Emergency</th>
                  <th className="py-1 font-semibold">Allergies / medical</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr
                    key={r.studentId}
                    className="border-b border-gray-200 align-top [break-inside:avoid]"
                  >
                    <td className="py-1 pr-2 font-medium">{r.name}</td>
                    <td className="py-1 pr-2 font-mono tracking-wide">
                      {r.wristbandCode}
                    </td>
                    <td className="py-1 pr-2">{r.age ?? "—"}</td>
                    <td className="py-1 pr-2">
                      {r.needsRouting ? (
                        <span className="font-semibold text-gray-900">
                          ⚠ No van / needs routing
                          {r.vanAndStop ? ` — ${r.vanAndStop}` : ""}
                        </span>
                      ) : (
                        r.vanAndStop
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <div>{r.guardianName || "—"}</div>
                      <div className="whitespace-nowrap text-gray-700">
                        {r.guardianPhone || "—"}
                      </div>
                    </td>
                    <td className="py-1 pr-2">
                      {r.emergencyName || r.emergencyPhone ? (
                        <>
                          <div>{r.emergencyName ?? "—"}</div>
                          <div className="whitespace-nowrap text-gray-700">
                            {r.emergencyPhone ?? "—"}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1">
                      <MedicalCell allergies={r.allergies} medical={r.medicalNotes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function ColorSwatch({ hex }: { hex: string | null }) {
  return (
    <span
      className="failsafe-swatch inline-block size-3 shrink-0 rounded-sm border border-gray-400"
      style={{ backgroundColor: hex ?? "#ffffff", color: contrastText(hex) }}
      aria-hidden
    />
  );
}

function MedicalCell({
  allergies,
  medical,
}: {
  allergies: string | null;
  medical: string | null;
}) {
  if (!allergies && !medical) return <span className="text-gray-500">—</span>;
  return (
    <span className="text-gray-900">
      {allergies ? <span className="font-semibold">Allergies: {allergies}</span> : null}
      {allergies && medical ? " · " : null}
      {medical ? <span>{medical}</span> : null}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
