"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CSSProperties } from "react";
import { contrastText, type NameTag } from "@/lib/nametags/tag-data";

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
            {tags.length} tag{tags.length === 1 ? "" : "s"} · prints on plain
            letter paper, cut along the dashed lines.
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
      </div>

      {tags.length === 0 ? (
        <p className="print:hidden mt-8 text-sm text-muted-foreground">
          No attending students for this date{town || van ? " with these filters" : ""}.
        </p>
      ) : (
        <div className="nametag-grid mt-4 grid grid-cols-2 gap-3 print:mt-0 print:gap-0">
          {tags.map((t) => (
            <article
              key={t.studentId}
              className="nametag-card flex flex-col overflow-hidden rounded-lg border border-dashed border-gray-400 bg-white"
            >
              <NameTagBand tag={t} />
              <div className="flex flex-1 flex-col items-center justify-center px-3 py-2 text-center text-gray-900">
                <span className="nametag-name text-3xl font-bold leading-tight [overflow-wrap:anywhere]">
                  {t.firstName}
                </span>
                <span className="text-lg font-medium [overflow-wrap:anywhere]">
                  {t.lastName}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 px-3 py-1 text-sm text-gray-700">
                <span>{t.vanName ?? "No van"}</span>
                <code className="font-mono tracking-widest">{t.wristbandCode}</code>
              </div>
            </article>
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
  // Show both colors only when the morning and afternoon stops differ — a kid
  // dropped off at one stop but riding the van home from another.
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
  return (
    <div
      className="nametag-band px-3 py-1.5 text-sm font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: t.colorCode ?? "#e5e7eb",
        color: contrastText(t.colorCode),
      }}
    >
      {t.colorName ?? "P"}
      {t.town ? ` · ${t.town}` : " · Parent drop-off"}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
