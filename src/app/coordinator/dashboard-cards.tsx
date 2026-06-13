import {
  UsersIcon,
  BusIcon,
  MapPinIcon,
  CheckCircle2Icon,
  HomeIcon,
  UserXIcon,
  AlertTriangleIcon,
  type LucideIcon,
} from "lucide-react";
import type { DashboardMetrics, TownRow } from "@/lib/coordinator/dashboard";

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
  towns,
}: {
  metrics: DashboardMetrics;
  towns: TownRow[];
}) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {CARDS.map(({ key, label, tone, Icon }) => {
          const value = metrics[key];
          const muted = value === 0;
          return (
            <div
              key={key}
              className="rounded-xl border bg-card p-4 border-t-4"
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
              <div className="mt-1.5 text-sm font-medium text-muted-foreground">
                {label}
              </div>
            </div>
          );
        })}
      </section>

      {towns.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Kids coming by town
          </h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {towns.map((t) => (
              <div key={t.town} className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="size-4 rounded-full border shrink-0"
                    style={{ backgroundColor: t.colorCode ?? "var(--muted)" }}
                    aria-hidden
                  />
                  <span className="font-medium text-sm truncate">{t.town}</span>
                </div>
                <div className="mt-2 text-4xl font-bold leading-none tabular-nums">
                  {t.expected}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  coming · {t.checkedIn} in · {t.home} home
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
