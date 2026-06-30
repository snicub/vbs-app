"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { type DayState } from "@/lib/events/state-machine";
import { StateBadge, SafetyPills } from "@/components/state-badge";

export type CheckinRow = {
  id: string;
  code: string;
  name: string;
  family: string;
  state: string;
  allergies: string | null;
  medicalNotes: string | null;
};

/**
 * Check-in entry: the full list of kids expected today, searchable by name or
 * family. Tap a child to open their check-in actions. No wristband — staff find
 * a kid by name when they arrive at the building.
 */
export function TableCheckinList({ rows }: { rows: CheckinRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (q.length < 2) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.family.toLowerCase().includes(q),
    );
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <Input
        autoFocus
        placeholder="Search by name or family…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-base"
      />
      <p className="text-xs text-muted-foreground">
        {q.length < 2
          ? `${rows.length} ${rows.length === 1 ? "child" : "children"} expected today — tap one to check them in`
          : `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`}
      </p>

      <ul className="rounded-lg border divide-y bg-card">
        {filtered.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => router.push(`/table/${r.code}`)}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 min-h-14 text-left hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-base font-medium">{r.name}</span>
                  <SafetyPills allergies={r.allergies} medicalNotes={r.medicalNotes} />
                </span>
                {r.family && (
                  <span className="block truncate text-xs text-muted-foreground">{r.family}</span>
                )}
              </span>
              <StateBadge state={r.state as DayState} size="sm" />
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-10 text-center text-sm text-muted-foreground">
            No children match “{query.trim()}”.
          </li>
        )}
      </ul>
    </div>
  );
}
