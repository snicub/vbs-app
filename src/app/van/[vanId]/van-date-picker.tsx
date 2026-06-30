"use client";

import { useRouter } from "next/navigation";

/**
 * Lets a driver/aide switch the rider list between the VBS days — mainly so they
 * can open the first day and rehearse before the event (the page otherwise shows
 * only the literal current date, which is empty until the event starts). When the
 * shown day isn't actually today, a loud "rehearsal" note warns that any Board /
 * Drop-off taps record real events for that day.
 */
export function VanDatePicker({
  vanId,
  dates,
  selected,
  today,
}: {
  vanId: string;
  dates: string[];
  selected: string;
  today: string;
}) {
  const router = useRouter();
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => router.push(`/van/${vanId}?date=${d}`)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              d === selected
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted"
            }`}
          >
            {labelFor(d)}
            {d === today ? " · today" : ""}
          </button>
        ))}
      </div>
      {selected !== today && (
        <p className="rounded-md bg-[var(--anomaly-warn)]/15 px-2.5 py-1.5 text-xs font-medium text-[var(--anomaly-warn)]">
          Rehearsal mode — showing {labelFor(selected)}, not today. Any Board / Drop-off
          taps record real events for that day; undo them when you&apos;re done.
        </p>
      )}
    </div>
  );
}

function labelFor(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}
