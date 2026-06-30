"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { contrastText } from "@/lib/nametags/tag-data";

type Region = { id: string; name: string; colorCode: string | null; colorName: string | null };

const ALIGN_KEY = "nametag-align-mm";
const POS_KEY = "nametag-quick-pos";
// Same default + storage key as the full name-tag sheet, so the alignment you dial
// in on either screen applies to both.
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

/**
 * Print a single name tag on demand — for a walk-in, a late check-in, or a helper.
 * Pick which of the 8 Avery 5395 label positions to print on so a partially-used
 * sheet can be fed back through and filled up one tag at a time. Reuses the same
 * print CSS (and per-printer alignment nudge) as the full sheet.
 */
export function QuickNameTag({ regions }: { regions: Region[] }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [regionId, setRegionId] = useState("");
  const [position, setPosition] = useState(1);
  const [align, setAlign] = useState(DEFAULT_ALIGN);

  useEffect(() => {
    try {
      const a = localStorage.getItem(ALIGN_KEY);
      if (a) {
        const v = JSON.parse(a);
        if (typeof v?.x === "number" && typeof v?.y === "number") setAlign(v);
      }
      const p = Number(localStorage.getItem(POS_KEY));
      if (p >= 1 && p <= 8) setPosition(p);
    } catch {
      /* ignore */
    }
  }, []);

  function persistAlign(next: { x: number; y: number }) {
    setAlign(next);
    try {
      localStorage.setItem(ALIGN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function nudge(dx: number, dy: number) {
    persistAlign({ x: align.x + dx, y: align.y + dy });
  }

  const region = regions.find((r) => r.id === regionId) ?? null;
  const colorCode = region?.colorCode ?? "#e5e7eb";
  const bandLabel = region?.name ?? "Parent drop-off";
  const colorName = region?.colorName ?? "P";

  function print() {
    if (!first.trim() && !last.trim()) return;
    window.print();
    // Advance to the next label so the next tag fills the sheet (wrap 8 → 1).
    const next = (position % 8) + 1;
    setPosition(next);
    try {
      localStorage.setItem(POS_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  const card = (
    <article className="nametag-card flex flex-col overflow-hidden rounded-lg border border-dashed border-gray-400 bg-white">
      <div
        className="nametag-band flex items-baseline justify-between gap-2 px-3 py-1.5 uppercase tracking-wide"
        style={
          {
            backgroundColor: colorCode,
            color: contrastText(colorCode),
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          } as CSSProperties
        }
      >
        <span className="text-base font-bold [overflow-wrap:anywhere]">{bandLabel}</span>
        <span className="shrink-0 text-sm font-semibold">{colorName}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-3 py-3 text-center text-gray-900">
        <span className="nametag-name px-1 text-3xl font-bold leading-tight [overflow-wrap:anywhere]">
          {first || " "}
        </span>
        {last && <span className="px-1 text-lg font-medium [overflow-wrap:anywhere]">{last}</span>}
      </div>
    </article>
  );

  return (
    <>
      <div className="print:hidden space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Quick name tag</h1>
          <p className="text-sm text-muted-foreground">
            Print one tag on an Avery 5395 sheet. Pick the label position so you can reuse a
            partly-used sheet. Print at <span className="font-medium">100% / Actual size</span>.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">First name</span>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Last name (optional)</span>
            <Input value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block text-muted-foreground">Region / color (optional)</span>
            <Select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              <option value="">No region (grey band)</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.colorName ? ` — ${r.colorName}` : ""}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">Label position on the sheet</span>
          <div className="grid w-40 grid-cols-2 gap-1.5">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPosition(n)}
                className={`flex h-12 items-center justify-center rounded-md border text-sm font-medium ${
                  n === position
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Next tag prints on label <strong>{position}</strong> of 8 (then advances automatically).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium">Label alignment</span>
          <span className="text-xs text-muted-foreground">shared with the full sheet</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => nudge(0, -1)} className={NUDGE_BTN} title="Move up">▲</button>
            <button type="button" onClick={() => nudge(-1, 0)} className={NUDGE_BTN} title="Move left">◀</button>
            <button type="button" onClick={() => nudge(1, 0)} className={NUDGE_BTN} title="Move right">▶</button>
            <button type="button" onClick={() => nudge(0, 1)} className={NUDGE_BTN} title="Move down">▼</button>
            <button
              type="button"
              onClick={() => persistAlign({ x: 0, y: 0 })}
              className="ml-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
            >
              Reset
            </button>
          </div>
          <span className="w-full text-xs text-muted-foreground">{describeAlign(align)}</span>
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={print} disabled={!first.trim() && !last.trim()}>
            Print this tag
          </Button>
          <div className="w-56">
            <div className="mb-1 text-xs text-muted-foreground">Preview</div>
            <div className="h-28">{card}</div>
          </div>
        </div>
      </div>

      {/* Print-only: the full Avery sheet with the tag in the chosen position. */}
      <div className="hidden print:block">
        <div
          className="nametag-page grid grid-cols-2 gap-0"
          style={{ "--align-x": `${align.x}mm`, "--align-y": `${align.y}mm` } as CSSProperties}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="nametag-card">
              {i + 1 === position ? card : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
