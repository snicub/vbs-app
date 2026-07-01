"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { XIcon } from "lucide-react";
import { type AnomalyKind } from "@/lib/anomaly";
import { STATE_PRESENTATION, safeDayState } from "@/lib/state-presentation";
import { StateBadge, SafetyPills } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { METRIC_MATCHERS, METRIC_LABELS, type MetricKey } from "@/lib/coordinator/dashboard";
import { bulkSendHome } from "@/server-actions/check-out";

export type RosterStudent = {
  student_id: string;
  state: string;
  name: string;
  familyName: string;
  wristbandCode: string;
  wristband_color_for_day: string | null;
  wristband_color_name: string | null;
  last_event_at?: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  photoUrl: string | null;
  anomalies: AnomalyKind[];
};

// Views where the useful order is most-recent-first (newest check-in / arrival
// / home on top) rather than the dashboard's anomaly-then-state order.
const RECENCY_METRICS = new Set<MetricKey>(["atSite", "checkedIn", "home"]);

export function RosterList({
  students,
  show,
  date,
}: {
  students: RosterStudent[];
  /** Active stat-card filter from the URL; null = whole roster. */
  show?: MetricKey | null;
  /** The viewed day, so the "clear filter" link preserves it. */
  date?: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  // Tapping a stat card changes ?show= but App Router doesn't scroll to the
  // #roster hash on a query-only nav, so it looks like "nothing happened."
  // Scroll the filtered list into view whenever the active filter changes.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (show) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [show]);

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const filtered = show
    ? students.filter((s) =>
        METRIC_MATCHERS[show]({ state: s.state, hasAnomaly: s.anomalies.length > 0 }),
      )
    : students;
  // For check-in views, put the most recently checked-in kid on top.
  const byMetric =
    show && RECENCY_METRICS.has(show)
      ? filtered
          .slice()
          .sort((a, b) => (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""))
      : filtered;
  const visible = needle
    ? byMetric.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.familyName.toLowerCase().includes(needle) ||
          s.wristbandCode.toLowerCase().includes(needle),
      )
    : byMetric;

  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selected.has(s.student_id));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((s) => next.delete(s.student_id));
      else visible.forEach((s) => next.add(s.student_id));
      return next;
    });
  }
  function sendSelectedHome() {
    const ids = Array.from(selected);
    if (ids.length === 0 || !date) return;
    startTransition(async () => {
      const res = await bulkSendHome({ studentIds: ids, eventDate: date });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.home} sent home${res.skipped ? ` · ${res.skipped} skipped` : ""}`);
      setSelected(new Set());
      setSelectMode(false);
      router.refresh();
    });
  }

  return (
    <section ref={sectionRef} id="roster" className="rounded-xl border bg-card overflow-hidden scroll-mt-4">
      <div className="border-b px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
        <h2 className="font-semibold text-sm shrink-0">
          {show ? `${METRIC_LABELS[show]} (${byMetric.length})` : `Roster (${students.length})`}
        </h2>
        {show && (
          <Link
            href={`/coordinator${date ? `?date=${date}` : ""}#roster`}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            <XIcon className="size-3" /> clear filter
          </Link>
        )}
        <input
          type="search"
          placeholder="Search by name, family, or wristband code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:max-w-xs rounded-md border bg-background px-3 py-1.5 text-base sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-11 md:min-h-9"
        />
        {needle && (
          <span className="text-xs text-muted-foreground shrink-0">
            {visible.length} of {byMetric.length}
          </span>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          {selectMode && visible.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                className="size-4"
              />
              All ({visible.length})
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className="rounded-full border px-3 min-h-8 text-xs hover:bg-muted/40 shrink-0"
          >
            {selectMode ? "Cancel select" : "Select"}
          </button>
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 border-b bg-primary/10 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" onClick={sendSelectedHome} disabled={pending}>
            {pending ? "Sending…" : "Send home"}
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground underline"
          >
            clear
          </button>
        </div>
      )}
      {visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
          {needle
            ? `No students match “${query}”`
            : show
              ? `No kids in “${METRIC_LABELS[show]}” right now.`
              : "No students."}
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((s) => {
            const state = safeDayState(s.state);
            const tone = STATE_PRESENTATION[state].tone;
            return (
              <li
                key={s.student_id}
                className="hover:bg-muted/40 active:bg-muted border-l-4"
                style={{
                  borderLeftColor:
                    state === "not_started"
                      ? "transparent"
                      : `var(--state-${tone})`,
                }}
              >
                <div className="flex items-center">
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selected.has(s.student_id)}
                    onChange={() => toggle(s.student_id)}
                    className="ml-3 size-5 shrink-0"
                    aria-label={`Select ${s.name}`}
                  />
                )}
                <Link
                  href={`/table/${s.wristbandCode}`}
                  className="flex-1 min-w-0 flex items-center gap-3 px-3 sm:px-4 py-3 min-h-14"
                >
                  <Avatar url={s.photoUrl} alt={s.name} size={40} />
                  <ColorDot
                    color={s.wristband_color_for_day}
                    name={s.wristband_color_name}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <code className="font-mono">{s.wristbandCode}</code>
                      {s.wristband_color_name && (
                        <span>· {s.wristband_color_name}</span>
                      )}
                    </div>
                  </div>
                  <SafetyPills
                    allergies={s.allergies}
                    medicalNotes={s.medicalNotes}
                  />
                  <StateBadge state={state} size="sm" />
                </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ColorDot({
  color,
  name,
}: {
  color: string | null;
  name: string | null;
}) {
  if (!color) {
    return (
      <span
        className="inline-block w-4 h-4 rounded-full border bg-muted shrink-0"
        title="No wristband color"
      />
    );
  }
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 border-card shadow-sm shrink-0 ring-1 ring-border"
      style={{ backgroundColor: color }}
      title={`Wristband color: ${name ?? color}`}
      aria-label={`Wristband color: ${name ?? color}`}
    />
  );
}

export function Avatar({
  url,
  alt,
  size = 40,
}: {
  url: string | null;
  alt: string;
  size?: number;
}) {
  const base = "rounded-full border object-cover shrink-0 bg-muted";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        className={base}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={
        base +
        " text-[11px] font-medium text-muted-foreground flex items-center justify-center"
      }
      style={{ width: size, height: size }}
    >
      {alt
        .split(/\s+/)
        .map((s) => s[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}
