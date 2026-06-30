import Link from "next/link";
import {
  UsersIcon,
  BusIcon,
  MapPinIcon,
  CheckCircle2Icon,
  HomeIcon,
  UserXIcon,
  AlertTriangleIcon,
  ChevronRightIcon,
  type LucideIcon,
} from "lucide-react";
import type { DashboardMetrics, VanRow } from "@/lib/coordinator/dashboard";

type CardDef = {
  key: keyof DashboardMetrics;
  label: string;
  tone: string; // maps to a --state-* / --anomaly-* CSS var
  Icon: LucideIcon;
};

const CARDS: CardDef[] = [
  { key: "expected", label: "Expected today", tone: "var(--foreground)", Icon: UsersIcon },
  { key: "onBoard", label: "On a van now", tone: "var(--state-transit)", Icon: BusIcon },
  { key: "atSite", label: "At site now", tone: "var(--state-arrived)", Icon: MapPinIcon },
  { key: "checkedIn", label: "Checked in today", tone: "var(--state-safe)", Icon: CheckCircle2Icon },
  { key: "home", label: "Home safe", tone: "var(--state-home)", Icon: HomeIcon },
  { key: "noShow", label: "No-shows", tone: "var(--state-danger)", Icon: UserXIcon },
  { key: "needsAttention", label: "Needs attention", tone: "var(--anomaly-critical)", Icon: AlertTriangleIcon },
];

export function DashboardCards({
  metrics,
  vans,
  date,
}: {
  metrics: DashboardMetrics;
  vans: VanRow[];
  /** The day being viewed, threaded into each van-group link. */
  date: string;
}) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {CARDS.map(({ key, label, tone, Icon }) => {
          const value = metrics[key];
          const muted = value === 0;
          return (
            <Link
              key={key}
              href={`/coordinator?date=${date}&show=${key}#roster`}
              className="group rounded-xl border bg-card p-4 border-t-4 block transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderTopColor: muted ? "var(--border)" : tone }}
            >
              <Icon
                className="size-5"
                style={{ color: muted ? "var(--muted-foreground)" : tone }}
                aria-hidden
              />
              <div
                className="mt-2 text-4xl sm:text-5xl font-bold leading-none tabular-nums"
                style={{ color: muted ? "var(--muted-foreground)" : tone }}
              >
                {value}
              </div>
              <div className="mt-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground">
                {label}
              </div>
            </Link>
          );
        })}
      </section>

      {vans.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Kids coming by van
          </h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {vans.map((v) => (
              <Link
                key={v.vanName}
                href={`/coordinator/van-group/${v.vanId ?? "parent"}?date=${date}`}
                className="group rounded-xl border bg-card p-4 block transition hover:border-primary/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-4 rounded-full border shrink-0"
                    style={{ backgroundColor: v.colorCode ?? "var(--muted)" }}
                    aria-hidden
                  />
                  <span className="font-medium text-sm truncate">{v.vanName}</span>
                  <ChevronRightIcon className="size-4 ml-auto shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                </div>
                <div className="mt-2 text-4xl font-bold leading-none tabular-nums">
                  {v.expected}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  coming · {v.checkedIn} in · {v.home} home
                </div>
                <div className="mt-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Check kids in / out →
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
