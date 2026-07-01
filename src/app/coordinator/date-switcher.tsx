"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { VBS_DATES } from "@/lib/registration/dates";

function label(iso: string, realToday: string): string {
  const d = new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return iso === realToday ? `${d} · today` : d;
}

/**
 * Day picker for the coordinator dashboard. Sets ?date= so the whole dashboard
 * (metrics + per-region rollup) reflects that VBS day — e.g. look back at
 * yesterday's per-town checked-in / home counts.
 */
export function DateSwitcher({ date, realToday }: { date: string; realToday: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("date", next);
    router.push(`/coordinator?${sp.toString()}`);
  }

  return (
    <select
      aria-label="Pick a day"
      value={date}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-card px-2 min-h-10 md:min-h-9 text-sm"
    >
      {VBS_DATES.map((d) => (
        <option key={d} value={d}>
          {label(d, realToday)}
        </option>
      ))}
    </select>
  );
}
