"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildGroups, teachersNeeded, type GroupKid } from "@/lib/coordinator/groups";
import { cn } from "@/lib/utils";

export type BuilderKid = GroupKid & { present: boolean };

/**
 * Interactive class-group builder. Groups are formed from who's actually
 * checked in (default) or all expected, with live controls for group size or
 * number of groups (= teachers, one per group) and similar-vs-mixed ages.
 * Everything recomputes client-side; nothing is persisted (print the result).
 */
export function GroupsBuilder({ kids }: { kids: BuilderKid[] }) {
  const presentCount = kids.filter((k) => k.present).length;
  const [source, setSource] = useState<"present" | "all">(
    presentCount > 0 ? "present" : "all",
  );
  const [mode, setMode] = useState<"size" | "count" | "teachers">("size");
  const [size, setSize] = useState(10);
  const [count, setCount] = useState(6);
  const [teachers, setTeachers] = useState(6);
  const [perGroupTeachers, setPerGroupTeachers] = useState(1);
  const [mix, setMix] = useState(false);
  // Optional age-range filter: build groups from only kids in this band.
  const [minAge, setMinAge] = useState<number | null>(null);
  const [maxAge, setMaxAge] = useState<number | null>(null);
  // When set (a group index), only that group is shown to the printer.
  const [printOnly, setPrintOnly] = useState<number | null>(null);
  useEffect(() => {
    if (printOnly == null) return;
    window.print();
    setPrintOnly(null);
  }, [printOnly]);
  // Teacher names per group, keyed by group INDEX (stable across control tweaks —
  // the label embeds the age range, which changes when you regroup).
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

  const { groups, poolCount } = useMemo(() => {
    let pool = source === "present" ? kids.filter((k) => k.present) : kids;
    if (minAge != null || maxAge != null) {
      pool = pool.filter(
        (k) =>
          k.age != null &&
          (minAge == null || k.age >= minAge) &&
          (maxAge == null || k.age <= maxAge),
      );
    }
    return {
      groups: buildGroups(pool, {
        mode,
        targetSize: size,
        groupCount: count,
        availableTeachers: teachers,
        teachersPerGroup: perGroupTeachers,
        mix,
      }),
      poolCount: pool.length,
    };
  }, [kids, source, mode, size, count, teachers, perGroupTeachers, mix, minAge, maxAge]);

  const perGroup =
    groups.length > 0 ? Math.round((poolCount / groups.length) * 10) / 10 : 0;
  const needed = teachersNeeded(groups.length, perGroupTeachers);
  // In "by teachers" mode, surface whether the staff covers the groups made.
  const teacherDiff = mode === "teachers" ? teachers - needed : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-4 print:hidden">
        <Seg
          label="Group from"
          value={source}
          onChange={(v) => setSource(v as "present" | "all")}
          options={[
            { value: "present", label: `Checked in (${presentCount})` },
            { value: "all", label: `All expected (${kids.length})` },
          ]}
        />
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
          <NumberField
            label="Teachers / group"
            value={perGroupTeachers}
            min={1}
            max={5}
            onChange={setPerGroupTeachers}
          />
          <Seg
            label="Ages"
            value={mix ? "mix" : "similar"}
            onChange={(v) => setMix(v === "mix")}
            options={[
              { value: "similar", label: "Similar together" },
              { value: "mix", label: "Mixed" },
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
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="ml-auto"
          >
            Print
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {poolCount === 0
            ? "No kids in this pool yet."
            : `${poolCount} kids → ${groups.length} ${groups.length === 1 ? "group" : "groups"} · ~${perGroup} per group · needs ${needed} ${needed === 1 ? "teacher" : "teachers"}${perGroupTeachers > 1 ? ` (${perGroupTeachers} per group)` : ""}${teacherDiff > 0 ? ` · ${teacherDiff} spare` : ""}${teacherDiff < 0 ? ` · ⚠ ${-teacherDiff} short` : ""}.`}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          {source === "present"
            ? "No kids are checked in yet. Switch to “All expected” to pre-plan groups."
            : "No kids attending on this day."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:block print:gap-0">
          {groups.map((g, gi) => (
            <section
              key={gi}
              className={cn(
                "roster-section rounded-xl border bg-card overflow-hidden break-inside-avoid",
                // One-per-page only when printing the whole set; a single-group
                // print needs no leading break (avoids a blank first page).
                printOnly == null && "print:break-before-page",
                printOnly != null && printOnly !== gi && "print:hidden",
              )}
            >
              <header className="border-b bg-muted/40 px-4 py-2 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold print:text-2xl">{g.label}</h2>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground print:text-base">
                      {g.count} {g.count === 1 ? "kid" : "kids"}
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
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
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
              value === o.value
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground",
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
