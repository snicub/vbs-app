"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { type DayState } from "@/lib/events/state-machine";
import { StateBadge, SafetyPills } from "@/components/state-badge";
import { PencilIcon } from "lucide-react";

export type StudentRow = {
  id: string;
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  wristbandCode: string;
  dob: string | null;
  ageAtRegistration: number | null;
  grade: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  familyName: string;
  familyPhone: string;
  state: string;
  colorName: string | null;
  morningStop: string;
  afternoonStop: string;
};

type SortKey = "name" | "status" | "dob" | "morningStop" | "afternoonStop";
type SortDir = "asc" | "desc";

const STATE_RANK: Record<DayState, number> = {
  not_started: 0,
  van_boarded_am: 1,
  arrived_at_site: 2,
  site_checked_in: 3,
  site_checked_out: 4,
  van_boarded_pm: 5,
  home: 6,
  marked_no_show: 7,
};

export function StudentsTable({ rows }: { rows: StudentRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = rows;
    if (q) {
      arr = rows.filter(
        (r) =>
          r.firstName.toLowerCase().includes(q) ||
          r.lastName.toLowerCase().includes(q) ||
          r.wristbandCode.toLowerCase().includes(q) ||
          r.familyName.toLowerCase().includes(q) ||
          r.morningStop.toLowerCase().includes(q) ||
          r.afternoonStop.toLowerCase().includes(q),
      );
    }
    const sorted = arr.slice().sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp =
            a.lastName.localeCompare(b.lastName) ||
            a.firstName.localeCompare(b.firstName);
          break;
        case "status":
          cmp = (STATE_RANK[a.state as DayState] ?? 99) - (STATE_RANK[b.state as DayState] ?? 99);
          break;
        case "dob":
          cmp = (a.dob ?? "").localeCompare(b.dob ?? "");
          break;
        case "morningStop":
          cmp = a.morningStop.localeCompare(b.morningStop);
          break;
        case "afternoonStop":
          cmp = a.afternoonStop.localeCompare(b.afternoonStop);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, query, sortKey, sortDir]);

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
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search name, wristband, family, stop…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {rows.length}
        </span>
      </div>

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
              <th className="text-left px-3 py-2 w-12"></th>
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
                  <Link
                    href={`/coordinator/students/${r.id}/edit`}
                    className="text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <PencilIcon className="size-4" />
                  </Link>
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
                  <Link href={`/table/${r.wristbandCode}`} className="font-medium hover:underline truncate">
                    {r.firstName} {r.lastName}
                  </Link>
                  <StateBadge state={r.state as DayState} size="sm" />
                </div>
                <SafetyPills allergies={r.allergies} medicalNotes={r.medicalNotes} />
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
