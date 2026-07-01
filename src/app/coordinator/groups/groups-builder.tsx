"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildGroups, teachersNeeded, type GroupKid } from "@/lib/coordinator/groups";
import { cn } from "@/lib/utils";

export type BuilderKid = GroupKid & { present: boolean };

// Saved groups persist in this browser so yesterday's arrangement loads as
// today's base — no DB. Use the same device each morning.
const STORAGE_KEY = "vbs.savedGroups.v1";
type Saved = { count: number; assignments: Record<string, number> };

const byName = (a: BuilderKid, b: BuilderKid) =>
  a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);

/**
 * Class-group builder. Two ways to make groups:
 *  - Auto: age-balanced from who's checked in, by size / #groups / #teachers.
 *  - Saved: yesterday's saved arrangement loads as the base; edit by moving kids
 *    between groups, drop new check-ins in from Unassigned, then Save again.
 */
export function GroupsBuilder({ kids }: { kids: BuilderKid[] }) {
  const presentCount = kids.filter((k) => k.present).length;
  const [source, setSource] = useState<"present" | "all">("present");
  const [method, setMethod] = useState<"auto" | "saved">("auto");
  const [mode, setMode] = useState<"size" | "count" | "teachers">("size");
  const [size, setSize] = useState(10);
  const [count, setCount] = useState(6);
  const [teachers, setTeachers] = useState(6);
  const [perGroupTeachers, setPerGroupTeachers] = useState(1);
  const [mix, setMix] = useState(false);
  const [minAge, setMinAge] = useState<number | null>(null);
  const [maxAge, setMaxAge] = useState<number | null>(null);
  const [printOnly, setPrintOnly] = useState<number | null>(null);
  // Master-doc print: every group on small cards, many per page.
  const [masterPrint, setMasterPrint] = useState(false);

  // Saved / manual arrangement: studentId → group number (1-indexed).
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (s && typeof s.count === "number" && s.assignments) {
          setSavedCount(s.count);
          setAssignments(s.assignments);
          if (Object.keys(s.assignments).length > 0) setMethod("saved");
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (printOnly == null) return;
    window.print();
    setPrintOnly(null);
  }, [printOnly]);

  useEffect(() => {
    if (!masterPrint) return;
    window.print();
    setMasterPrint(false);
  }, [masterPrint]);

  const [teacherNames, setTeacherNames] = useState<Record<number, string[]>>({});
  const teachersFor = (gi: number) => teacherNames[gi] ?? [""];
  function setTeacher(gi: number, idx: number, value: string) {
    setTeacherNames((prev) => {
      const list = [...(prev[gi] ?? [""])];
      list[idx] = value;
      return { ...prev, [gi]: list };
    });
  }
  function addTeacher(gi: number) {
    setTeacherNames((prev) => ({ ...prev, [gi]: [...(prev[gi] ?? [""]), ""] }));
  }
  function removeTeacher(gi: number, idx: number) {
    setTeacherNames((prev) => {
      const list = (prev[gi] ?? [""]).filter((_, i) => i !== idx);
      return { ...prev, [gi]: list.length ? list : [""] };
    });
  }

  const pool = useMemo(() => {
    let p = source === "present" ? kids.filter((k) => k.present) : kids;
    if (minAge != null || maxAge != null) {
      p = p.filter(
        (k) =>
          k.age != null &&
          (minAge == null || k.age >= minAge) &&
          (maxAge == null || k.age <= maxAge),
      );
    }
    return p;
  }, [kids, source, minAge, maxAge]);

  const autoGroups = useMemo(
    () =>
      buildGroups(pool, {
        mode,
        targetSize: size,
        groupCount: count,
        availableTeachers: teachers,
        teachersPerGroup: perGroupTeachers,
        mix,
      }),
    [pool, mode, size, count, teachers, perGroupTeachers, mix],
  );

  // Kids present but not placed in any saved group yet (new check-ins, or a fresh
  // manual build). They sit in an Unassigned bucket to be dropped into a group.
  const unassigned = useMemo(() => {
    if (method !== "saved") return [] as BuilderKid[];
    return pool
      .filter((k) => {
        const g = assignments[k.studentId];
        return !g || g < 1 || g > savedCount;
      })
      .sort(byName);
  }, [method, pool, assignments, savedCount]);

  const displayGroups =
    method === "auto"
      ? autoGroups.map((g) => ({ label: g.label, kids: g.kids as BuilderKid[] }))
      : Array.from({ length: savedCount }, (_, gi) => ({
          label: `Group ${gi + 1}`,
          kids: pool.filter((k) => assignments[k.studentId] === gi + 1).sort(byName),
        }));

  const poolCount = pool.length;
  const perGroup =
    displayGroups.length > 0
      ? Math.round((poolCount / displayGroups.length) * 10) / 10
      : 0;
  const needed = teachersNeeded(autoGroups.length, perGroupTeachers);
  const teacherDiff = mode === "teachers" ? teachers - needed : 0;

  function moveKid(studentId: string, group: number) {
    if (group === -1) {
      const g = savedCount + 1;
      setSavedCount(g);
      setAssignments((prev) => ({ ...prev, [studentId]: g }));
      return;
    }
    if (group === 0) {
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
      return;
    }
    setAssignments((prev) => ({ ...prev, [studentId]: group }));
  }

  function persist(nextCount: number, nextAssignments: Record<string, number>) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ count: nextCount, assignments: nextAssignments }),
      );
      toast.success("Groups saved — they'll load as the base next time");
    } catch {
      toast.error("Couldn't save on this device");
    }
  }

  function saveGroups() {
    persist(savedCount, assignments);
  }

  // Snapshot the current AUTO groups into an editable saved arrangement.
  function saveAutoAsBase() {
    const next: Record<string, number> = {};
    autoGroups.forEach((g, gi) => g.kids.forEach((k) => (next[k.studentId] = gi + 1)));
    setAssignments(next);
    setSavedCount(autoGroups.length);
    setMethod("saved");
    persist(autoGroups.length, next);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-4 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <Seg
            label="Groups"
            value={method}
            onChange={(v) => setMethod(v as "auto" | "saved")}
            options={[
              { value: "auto", label: "Auto-make" },
              { value: "saved", label: "Saved / edit" },
            ]}
          />
          <Seg
            label="Group from"
            value={source}
            onChange={(v) => setSource(v as "present" | "all")}
            options={[
              { value: "present", label: `Checked in (${presentCount})` },
              { value: "all", label: `All expected (${kids.length})` },
            ]}
          />
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Age range (optional)</div>
            <div className="flex items-center gap-1.5">
              <AgeInput value={minAge} placeholder="min" onChange={setMinAge} ariaLabel="Minimum age" />
              <span aria-hidden className="text-muted-foreground">–</span>
              <AgeInput value={maxAge} placeholder="max" onChange={setMaxAge} ariaLabel="Maximum age" />
              {(minAge != null || maxAge != null) && (
                <button
                  type="button"
                  onClick={() => {
                    setMinAge(null);
                    setMaxAge(null);
                  }}
                  className="rounded-md border px-2 min-h-9 text-xs hover:bg-muted/40"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Print (page each)
            </Button>
            <Button type="button" onClick={() => setMasterPrint(true)}>
              Master doc
            </Button>
          </div>
        </div>

        {method === "auto" ? (
          <div className="flex flex-wrap items-end gap-4">
            <Seg
              label="Make groups by"
              value={mode}
              onChange={(v) => setMode(v as "size" | "count" | "teachers")}
              options={[
                { value: "size", label: "Kids per group" },
                { value: "count", label: "# of groups" },
                { value: "teachers", label: "By teachers" },
              ]}
            />
            {mode === "size" ? (
              <NumberField label="Kids per group" value={size} min={2} max={40} onChange={setSize} />
            ) : mode === "count" ? (
              <NumberField label="Number of groups" value={count} min={1} max={30} onChange={setCount} />
            ) : (
              <NumberField label="Available teachers" value={teachers} min={1} max={40} onChange={setTeachers} />
            )}
            <NumberField label="Teachers / group" value={perGroupTeachers} min={1} max={5} onChange={setPerGroupTeachers} />
            <Seg
              label="Ages"
              value={mix ? "mix" : "similar"}
              onChange={(v) => setMix(v === "mix")}
              options={[
                { value: "similar", label: "Similar together" },
                { value: "mix", label: "Mixed" },
              ]}
            />
            <Button type="button" onClick={saveAutoAsBase} disabled={autoGroups.length === 0}>
              Save as base groups
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setSavedCount((c) => c + 1)}>
              + Add group
            </Button>
            <Button type="button" onClick={saveGroups}>
              Save groups
            </Button>
            <span className="text-sm text-muted-foreground">
              Yesterday&apos;s saved groups are the base — move kids as needed, then Save.
            </span>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {poolCount === 0
            ? "No kids in this pool yet."
            : `${poolCount} kids → ${displayGroups.length} ${displayGroups.length === 1 ? "group" : "groups"} · ~${perGroup} per group${method === "auto" ? ` · needs ${needed} ${needed === 1 ? "teacher" : "teachers"}${perGroupTeachers > 1 ? ` (${perGroupTeachers} per group)` : ""}${teacherDiff > 0 ? ` · ${teacherDiff} spare` : ""}${teacherDiff < 0 ? ` · ⚠ ${-teacherDiff} short` : ""}` : ""}${method === "saved" && unassigned.length > 0 ? ` · ${unassigned.length} unassigned` : ""}.`}
        </p>
      </div>

      {method === "saved" && unassigned.length > 0 && (
        <section className="rounded-xl border-2 border-[var(--anomaly-warn)]/50 bg-[var(--anomaly-warn)]/5 overflow-hidden print:hidden">
          <header className="border-b px-4 py-2 font-semibold text-sm">
            Unassigned — checked in but not in a group ({unassigned.length})
          </header>
          <ul className="divide-y">
            {unassigned.map((k) => (
              <li key={k.studentId} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="font-medium truncate">
                  {k.firstName} {k.lastName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {k.age != null ? `age ${k.age}` : "age —"}
                  </span>
                </span>
                <MoveSelect groupCount={savedCount} value={0} onMove={(g) => moveKid(k.studentId, g)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {displayGroups.length === 0 && unassigned.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          {method === "saved"
            ? "No saved groups yet. Tap “+ Add group” and move kids in, or switch to Auto-make and “Save as base groups.”"
            : source === "present"
              ? "No kids are checked in yet. Switch to “All expected” to pre-plan groups."
              : "No kids attending on this day."}
        </p>
      ) : (
        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:block print:gap-0",
            masterPrint && "groups-master",
          )}
        >
          {displayGroups.map((g, gi) => (
            <section
              key={gi}
              className={cn(
                "roster-section rounded-xl border bg-card overflow-hidden break-inside-avoid",
                printOnly == null && !masterPrint && "print:break-before-page",
                printOnly != null && printOnly !== gi && "print:hidden",
              )}
            >
              <header className="border-b bg-muted/40 px-4 py-2 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold print:text-2xl">{g.label}</h2>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground print:text-base">
                      {g.kids.length} {g.kids.length === 1 ? "kid" : "kids"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPrintOnly(gi)}
                      className="print:hidden rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Print
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm print:text-lg">
                  <span className="text-xs font-medium text-muted-foreground">
                    Teacher{teachersFor(gi).length > 1 ? "s" : ""}:
                  </span>
                  {teachersFor(gi).map((t, ti) => (
                    <span key={ti} className="inline-flex items-center gap-0.5">
                      <input
                        value={t}
                        onChange={(e) => setTeacher(gi, ti, e.target.value)}
                        placeholder="name"
                        className="w-28 rounded border-b border-dashed bg-transparent px-1 outline-none focus:bg-yellow-100 print:border-0 print:focus:bg-transparent"
                      />
                      {teachersFor(gi).length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTeacher(gi, ti)}
                          className="print:hidden text-muted-foreground hover:text-destructive"
                          title="Remove teacher"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => addTeacher(gi)}
                    className="print:hidden text-xs font-medium text-primary hover:underline"
                  >
                    + teacher
                  </button>
                </div>
              </header>
              <ul className="divide-y">
                {g.kids.map((k) => (
                  <li
                    key={k.studentId}
                    className="flex items-center justify-between gap-2 px-4 py-2 print:px-2 print:py-2.5"
                  >
                    <Link
                      href={`/table/${k.wristbandCode}`}
                      className="font-medium hover:underline truncate print:text-xl"
                    >
                      {k.firstName} {k.lastName}
                    </Link>
                    <span className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground print:text-base">
                      <span>{k.age != null ? `age ${k.age}` : "age —"}</span>
                      <code className="font-mono print:hidden">{k.wristbandCode}</code>
                      {method === "saved" && (
                        <MoveSelect
                          groupCount={savedCount}
                          value={gi + 1}
                          onMove={(grp) => moveKid(k.studentId, grp)}
                        />
                      )}
                    </span>
                  </li>
                ))}
                {g.kids.length === 0 && (
                  <li className="px-4 py-3 text-xs text-muted-foreground print:hidden">
                    Empty — move kids here from another group or Unassigned.
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-kid group picker (screen only). value 0 = unassigned.
function MoveSelect({
  groupCount,
  value,
  onMove,
}: {
  groupCount: number;
  value: number;
  onMove: (group: number) => void;
}) {
  return (
    <select
      aria-label="Move to group"
      value={value}
      onChange={(e) => onMove(Number(e.target.value))}
      className="print:hidden h-8 rounded-md border bg-card px-1.5 text-xs"
    >
      <option value={0}>Unassigned</option>
      {Array.from({ length: groupCount }, (_, i) => (
        <option key={i} value={i + 1}>
          Group {i + 1}
        </option>
      ))}
      <option value={-1}>+ New group</option>
    </select>
  );
}

function Seg({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 min-h-9 text-sm font-medium transition-colors",
              value === o.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="inline-flex items-center rounded-lg border bg-background">
        <button
          type="button"
          className="px-3 min-h-9 text-lg hover:bg-muted/40"
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label="Decrease"
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.floor(n))));
          }}
          className="w-12 bg-transparent text-center text-base md:text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          className="px-3 min-h-9 text-lg hover:bg-muted/40"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

function AgeInput({
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
        onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null);
      }}
      className="w-16 rounded-md border bg-background px-2 min-h-9 text-base md:text-sm text-foreground"
    />
  );
}
