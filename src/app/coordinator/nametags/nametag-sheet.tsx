"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CSSProperties } from "react";
import { contrastText, type NameTag } from "@/lib/nametags/tag-data";

const ALIGN_KEY = "nametag-align-mm";
// Default nudge: 2mm left + 2mm down, correcting the common "prints high and to
// the right" offset. Adjust per printer with the on-screen controls.
const DEFAULT_ALIGN = { x: -2, y: 2 };
const NUDGE_BTN =
  "rounded-md border px-2.5 py-1.5 text-sm leading-none hover:bg-muted active:bg-muted/70";

function describeAlign(a: { x: number; y: number }): string {
  if (a.x === 0 && a.y === 0) return "No nudge — using the default label margins.";
  const parts: string[] = [];
  if (a.x !== 0) parts.push(`${Math.abs(a.x)}mm ${a.x < 0 ? "left" : "right"}`);
  if (a.y !== 0) parts.push(`${Math.abs(a.y)}mm ${a.y < 0 ? "up" : "down"}`);
  return `Nudged ${parts.join(" + ")}.`;
}

export function NameTagSheet({
  tags,
  date,
  town,
  van,
  towns,
  vans,
}: {
  tags: NameTag[];
  date: string;
  town: string;
  van: string;
  towns: string[];
  vans: string[];
}) {
  const router = useRouter();
  // Per-printer print alignment nudge (mm). Persisted so it sticks across visits.
  const [align, setAlign] = useState(DEFAULT_ALIGN);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ALIGN_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v?.x === "number" && typeof v?.y === "number") setAlign(v);
      }
    } catch {
      /* ignore */
    }
  }, []);
  function nudge(dx: number, dy: number) {
    setAlign((a) => {
      const next = { x: a.x + dx, y: a.y + dy };
      try {
        localStorage.setItem(ALIGN_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  function resetAlign() {
    setAlign({ x: 0, y: 0 });
    try {
      localStorage.setItem(ALIGN_KEY, JSON.stringify({ x: 0, y: 0 }));
    } catch {
      /* ignore */
    }
  }

  function applyFilters(next: { date?: string; town?: string; van?: string }) {
    const params = new URLSearchParams();
    const d = next.date ?? date;
    const t = next.town ?? town;
    const v = next.van ?? van;
    if (d) params.set("date", d);
    if (t) params.set("town", t);
    if (v) params.set("van", v);
    router.push(`/coordinator/nametags?${params.toString()}`);
  }

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">
      <div className="print:hidden space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Name tags — {formatDate(date)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tags.length} tag{tags.length === 1 ? "" : "s"} · sized for{" "}
            <span className="font-medium text-foreground">Avery 5395</span> adhesive name
            badges (8 per sheet). Print at <span className="font-medium text-foreground">100% / Actual size</span> — not &ldquo;fit to page.&rdquo;
          </p>
          <p className="text-sm text-muted-foreground">
            Tap a name to edit it before printing — changes apply to this printout only.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => applyFilters({ date: e.target.value })}
              className="w-auto"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Town</span>
            <Select value={town} onChange={(e) => applyFilters({ town: e.target.value })}>
              <option value="">All towns</option>
              {towns.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Van</span>
            <Select value={van} onChange={(e) => applyFilters({ van: e.target.value })}>
              <option value="">All vans</option>
              {vans.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <Button onClick={() => window.print()} className="ml-auto">
            Print name tags
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium">Label alignment</span>
          <span className="text-xs text-muted-foreground">
            print one test sheet, then nudge (1mm per tap) until the tags sit on the labels
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => nudge(0, -1)} className={NUDGE_BTN} title="Move up">
              ▲
            </button>
            <button type="button" onClick={() => nudge(-1, 0)} className={NUDGE_BTN} title="Move left">
              ◀
            </button>
            <button type="button" onClick={() => nudge(1, 0)} className={NUDGE_BTN} title="Move right">
              ▶
            </button>
            <button type="button" onClick={() => nudge(0, 1)} className={NUDGE_BTN} title="Move down">
              ▼
            </button>
            <button
              type="button"
              onClick={resetAlign}
              className="ml-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
            >
              Reset
            </button>
          </div>
          <span className="w-full text-xs text-muted-foreground">{describeAlign(align)}</span>
        </div>
      </div>

      {tags.length === 0 ? (
        <p className="print:hidden mt-8 text-sm text-muted-foreground">
          No attending students for this date{town || van ? " with these filters" : ""}.
        </p>
      ) : (
        <div className="mt-4 space-y-6 print:mt-0 print:space-y-0">
          {chunk(tags, 8).map((pageTags, pi) => (
            <div
              key={pi}
              className="nametag-page grid grid-cols-2 gap-3 print:gap-0"
              style={
                {
                  "--align-x": `${align.x}mm`,
                  "--align-y": `${align.y}mm`,
                } as CSSProperties
              }
            >
              {pageTags.map((t) => (
                <article
                  key={t.studentId}
                  className="nametag-card flex flex-col overflow-hidden rounded-lg border border-dashed border-gray-400 bg-white"
                >
                  <NameTagBand tag={t} />
                  <div className="flex flex-1 flex-col items-center justify-center px-3 py-3 text-center text-gray-900">
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      className="nametag-name rounded px-1 text-3xl font-bold leading-tight [overflow-wrap:anywhere] outline-none focus:bg-yellow-100 print:focus:bg-transparent"
                    >
                      {t.firstName}
                    </span>
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      className="rounded px-1 text-lg font-medium [overflow-wrap:anywhere] outline-none focus:bg-yellow-100 print:focus:bg-transparent"
                    >
                      {t.lastName}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NameTagBand({ tag: t }: { tag: NameTag }) {
  // A van kid with no resolved stop/van must shout for attention, never read as
  // a calm parent drop-off — losing them onto no van is the failure mode here.
  if (t.needsRouting) {
    return (
      <div
        className="nametag-band px-3 py-1.5 text-sm font-bold uppercase tracking-wide"
        style={
          {
            backgroundColor: "#dc2626",
            color: "#ffffff",
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          } as CSSProperties
        }
      >
        ⚠ Needs routing — see coordinator
      </div>
    );
  }

  const am = t.morningColorCode;
  const pm = t.afternoonColorCode;
  // Door-to-door rarity: show both colors only when the resolved AM zone color
  // differs from the PM zone color — e.g. dropped off by a parent at one place
  // but vanned home from a different van's zone. Normal van kids have AM == PM
  // (one van zone) and fall through to the single band below.
  if (am && pm && am !== pm) {
    return (
      <div className="nametag-band flex text-sm font-semibold uppercase tracking-wide">
        <div
          className="flex-1 px-3 py-1.5"
          style={
            {
              backgroundColor: am,
              color: contrastText(am),
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            } as CSSProperties
          }
        >
          AM {t.morningColorName ?? ""}
        </div>
        <div
          className="flex-1 px-3 py-1.5 text-right"
          style={
            {
              backgroundColor: pm,
              color: contrastText(pm),
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            } as CSSProperties
          }
        >
          PM {t.afternoonColorName ?? ""}
        </div>
      </div>
    );
  }
  // Door-to-door: the band IS the van's pickup zone. Lead with the van name
  // (what a kid is routed to in the morning), with the color NAME alongside it
  // as the only failsafe if the band prints white (grayscale / ink-saving
  // drivers). Stop-less "parent-both" kids have no van/color → "P · Parent".
  return (
    <div
      className="nametag-band flex items-baseline justify-between gap-2 px-3 py-1.5 uppercase tracking-wide"
      style={{
        backgroundColor: t.colorCode ?? "#e5e7eb",
        color: contrastText(t.colorCode),
      }}
    >
      <span className="text-base font-bold [overflow-wrap:anywhere]">
        {t.vanName ?? "Parent drop-off"}
      </span>
      <span className="shrink-0 text-sm font-semibold">{t.colorName ?? "P"}</span>
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
