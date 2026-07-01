"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { type DayState } from "@/lib/events/state-machine";
import { STATE_PRESENTATION } from "@/lib/state-presentation";
import { StateBadge, SafetyPills } from "@/components/state-badge";
import {
  filterStudents,
  sortStudents,
  presentStates,
  presentTowns,
  type SortKey,
  type SortDir,
} from "@/lib/coordinator/student-filter";
import { PencilIcon } from "lucide-react";

export type StudentRow = {
  id: string;
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  wristbandCode: string;
  dob: string | null;
  ageAtRegistration: number | null;
  age: number | null;
  allergies: string | null;
  medicalNotes: string | null;
  familyName: string;
  familyPhone: string;
  address: string;
  state: string;
  morningStop: string;
  afternoonStop: string;
};

export function StudentsTable({
  rows,
  archivedRows = [],
}: {
  rows: StudentRow[];
  archivedRows?: StudentRow[];
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minAge, setMinAge] = useState<number | null>(null);
  const [maxAge, setMaxAge] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [town, setTown] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const baseRows = showArchived ? archivedRows : rows;
  const towns = useMemo(() => presentTowns(baseRows), [baseRows]);

  // Quick-pick age chips are for the K–12 kids (kindergarten ≈ 4 through 12th
  // grade ≈ 18). Adult leaders/helpers can register at higher ages, but we don't
  // render a chip for every one of them — the manual "Range" inputs below stay
  // unbounded for the rare case you need to filter an adult.
  const K12_MIN = 4;
  const K12_MAX = 18;
  const ageBounds = useMemo(() => {
    const ages = baseRows
      .map((r) => r.age)
      .filter((a): a is number => a != null && a >= K12_MIN && a <= K12_MAX);
    if (ages.length === 0) return null;
    return { min: Math.min(...ages), max: Math.max(...ages) };
  }, [baseRows]);

  const statuses = useMemo(() => presentStates(baseRows), [baseRows]);

  const filtered = useMemo(
    () =>
      sortStudents(filterStudents(baseRows, { query, minAge, maxAge, status, town }), sortKey, sortDir),
    [baseRows, query, sortKey, sortDir, minAge, maxAge, status, town],
  );

  const ageFilterActive = minAge != null || maxAge != null;

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <Input
          placeholder="Search name, wristband, family, stop…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        {towns.length > 1 && (
          <select
            aria-label="Filter by town"
            value={town ?? ""}
            onChange={(e) => setTown(e.target.value || null)}
            className="rounded-md border bg-card px-2 min-h-11 md:min-h-9 text-sm"
          >
            <option value="">All towns</option>
            {towns.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {baseRows.length}
        </span>
        {archivedRows.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={
              "ml-auto rounded-full border px-3 min-h-11 md:min-h-9 text-sm md:text-xs " +
              (showArchived
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/40")
            }
          >
            {showArchived ? "← Back to roster" : `Archived (${archivedRows.length})`}
          </button>
        )}
      </div>

      {showArchived && (
        <p className="text-sm text-muted-foreground">
          These children are hidden from rosters. Open one and tap{" "}
          <strong>Restore to roster</strong> to bring them back. Their records were kept.
        </p>
      )}

      {statuses.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s) => {
              const active = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(active ? null : s)}
                  className={
                    "rounded-full border px-3 min-h-11 md:min-h-9 text-sm md:text-xs " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card")
                  }
                >
                  {STATE_PRESENTATION[s as DayState]?.label ?? s}
                </button>
              );
            })}
            {status != null && (
              <button
                type="button"
                onClick={() => setStatus(null)}
                className="rounded-full border px-3 min-h-11 md:min-h-9 text-sm md:text-xs bg-card hover:bg-muted/40"
              >
                Clear status
              </button>
            )}
          </div>
        </div>
      )}

      {ageBounds && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-muted-foreground">Age</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(
              { length: ageBounds.max - ageBounds.min + 1 },
              (_, i) => ageBounds.min + i,
            ).map((age) => {
              const active = minAge === age && maxAge === age;
              return (
                <button
                  key={age}
                  type="button"
                  onClick={() => {
                    if (active) {
                      setMinAge(null);
                      setMaxAge(null);
                    } else {
                      setMinAge(age);
                      setMaxAge(age);
                    }
                  }}
                  className={
                    "rounded-full border px-3 min-h-11 md:min-h-9 text-sm md:text-xs " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card")
                  }
                >
                  {age}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Range</span>
            <NumberInput
              value={minAge}
              placeholder="min"
              onChange={setMinAge}
              ariaLabel="Minimum age"
            />
            <span aria-hidden>–</span>
            <NumberInput
              value={maxAge}
              placeholder="max"
              onChange={setMaxAge}
              ariaLabel="Maximum age"
            />
          </label>
          {ageFilterActive && (
            <button
              type="button"
              onClick={() => {
                setMinAge(null);
                setMaxAge(null);
              }}
              className="rounded-full border px-3 min-h-11 md:min-h-9 text-sm md:text-xs bg-card hover:bg-muted/40"
            >
              Clear age
            </button>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 w-12"></th>
              <SortableHeader label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="DOB" k="dob" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="AM stop" k="morningStop" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="PM stop" k="afternoonStop" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="text-left px-3 py-2">Family</th>
              <th className="text-left px-3 py-2 w-20">Code</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Avatar url={r.photoUrl} alt={`${r.firstName} ${r.lastName}`} />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/table/${r.wristbandCode}`} className="font-medium hover:underline">
                    {r.firstName} {r.lastName}
                  </Link>
                  <span className="ml-2 inline-flex">
                    <SafetyPills allergies={r.allergies} medicalNotes={r.medicalNotes} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StateBadge state={r.state as DayState} size="sm" />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.dob ?? (r.ageAtRegistration ? `age ${r.ageAtRegistration}` : "—")}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.morningStop || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.afternoonStop || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.familyName}
                  {r.familyPhone && <div className="text-xs">{r.familyPhone}</div>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.wristbandCode}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/table/${r.wristbandCode}`}
                      className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                      title="Check this child in"
                    >
                      Check in
                    </Link>
                    <Link
                      href={`/coordinator/students/${r.id}/edit`}
                      className="text-muted-foreground hover:text-foreground"
                      title="Edit"
                    >
                      <PencilIcon className="size-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No students match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        <div className="flex gap-2 overflow-x-auto py-1 -mx-1 px-1">
          {(["name", "status", "dob", "morningStop"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={
                "rounded-full border px-3 min-h-11 md:min-h-9 text-xs whitespace-nowrap " +
                (sortKey === k ? "bg-primary text-primary-foreground border-primary" : "bg-card")
              }
            >
              {sortLabel(k)} {sortKey === k && (sortDir === "asc" ? "↑" : "↓")}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-3 flex gap-3">
              <Avatar url={r.photoUrl} alt={`${r.firstName} ${r.lastName}`} size={48} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium truncate">
                    {r.firstName} {r.lastName}
                  </span>
                  <StateBadge state={r.state as DayState} size="sm" />
                </div>
                <SafetyPills allergies={r.allergies} medicalNotes={r.medicalNotes} />
                <Link
                  href={`/table/${r.wristbandCode}`}
                  className="inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Check in
                </Link>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div className="flex items-center gap-2">
                    <code className="font-mono">{r.wristbandCode}</code>
                    {r.dob && <> · {r.dob}</>}
                    <Link
                      href={`/coordinator/students/${r.id}/edit`}
                      className="ml-auto text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </div>
                  {r.morningStop && <div>AM: {r.morningStop}</div>}
                  {r.afternoonStop && <div>PM: {r.afternoonStop}</div>}
                  <div className="truncate">{r.familyName}{r.familyPhone && ` · ${r.familyPhone}`}</div>
                </div>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-center py-10 text-muted-foreground text-sm">No students match.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="text-left px-3 py-2">
      <button
        onClick={() => onClick(k)}
        className={
          "inline-flex items-center gap-1 hover:text-foreground " +
          (active ? "text-foreground" : "text-muted-foreground")
        }
      >
        {label}
        <span className="text-xs">{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function NumberInput({
  value,
  placeholder,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  placeholder: string;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value.trim();
        if (v === "") return onChange(null);
        const n = Number(v);
        onChange(Number.isFinite(n) ? n : null);
      }}
      className="w-16 rounded-md border bg-background px-2 min-h-11 md:min-h-9 text-base md:text-sm text-foreground"
    />
  );
}

function sortLabel(k: SortKey): string {
  switch (k) {
    case "name": return "Name";
    case "status": return "Status";
    case "dob": return "DOB";
    case "morningStop": return "AM stop";
    case "afternoonStop": return "PM stop";
  }
}

function Avatar({ url, alt, size = 40 }: { url: string | null; alt: string; size?: number }) {
  const base = "rounded-full border object-cover shrink-0 bg-muted";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} className={base} style={{ width: size, height: size }} />;
  }
  return (
    <span
      className={base + " text-[11px] font-medium text-muted-foreground flex items-center justify-center"}
      style={{ width: size, height: size }}
    >
      {alt.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
    </span>
  );
}
