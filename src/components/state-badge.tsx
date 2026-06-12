import { cn } from "@/lib/utils";
import {
  ANOMALY_PRESENTATION,
  ANOMALY_TONE_CLASSES,
  ALLERGY_PRESENTATION,
  MEDICAL_PRESENTATION,
  STATE_PRESENTATION,
  TONE_CLASSES,
} from "@/lib/state-presentation";
import type { DayState } from "@/lib/events/state-machine";
import type { AnomalyKind } from "@/lib/anomaly";

const SIZE: Record<
  "sm" | "md" | "lg",
  { wrapper: string; icon: string; text: string }
> = {
  sm: { wrapper: "px-2 py-0.5 rounded-md gap-1",          icon: "size-3",   text: "text-xs"  },
  md: { wrapper: "px-2.5 py-1 rounded-md gap-1.5",        icon: "size-3.5", text: "text-sm"  },
  lg: { wrapper: "px-3 py-1.5 rounded-lg gap-1.5",        icon: "size-4",   text: "text-sm"  },
};

/**
 * Renders a kid's current day state. Same shape everywhere — same color
 * on every screen, same icon, same wording.
 */
export function StateBadge({
  state,
  size = "md",
  className,
}: {
  state: DayState;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const p = STATE_PRESENTATION[state];
  const tone = TONE_CLASSES[p.tone];
  const sz = SIZE[size];
  const Icon = p.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center border font-medium whitespace-nowrap",
        tone.badge,
        sz.wrapper,
        sz.text,
        className,
      )}
      title={p.description}
    >
      <Icon className={sz.icon} aria-hidden />
      {p.label}
    </span>
  );
}

/**
 * Compact dot — for ultra-dense lists where a full badge wouldn't fit.
 */
export function StateDot({
  state,
  className,
}: {
  state: DayState;
  className?: string;
}) {
  const p = STATE_PRESENTATION[state];
  const tone = TONE_CLASSES[p.tone];
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full shrink-0", tone.dot, className)}
      title={p.label}
      aria-label={p.label}
    />
  );
}

export function AnomalyBadge({
  kind,
  size = "md",
  className,
}: {
  kind: AnomalyKind;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const p = ANOMALY_PRESENTATION[kind];
  const tone = ANOMALY_TONE_CLASSES[p.tone];
  const sz = SIZE[size];
  const Icon = p.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center border font-medium whitespace-nowrap",
        tone.badge,
        sz.wrapper,
        sz.text,
        className,
      )}
      title={p.description}
    >
      <Icon className={sz.icon} aria-hidden />
      {p.label}
    </span>
  );
}

/**
 * Loud-and-clear callout for medical OR allergy notes. Different tones so
 * a glance can tell them apart. Stacks both when both are present.
 */
export function SafetyCallout({
  allergies,
  medicalNotes,
  density = "comfortable",
}: {
  allergies: string | null | undefined;
  medicalNotes: string | null | undefined;
  density?: "compact" | "comfortable";
}) {
  if (!allergies && !medicalNotes) return null;
  const pad = density === "compact" ? "p-2 text-xs" : "p-3 text-sm";
  return (
    <div className="space-y-2">
      {medicalNotes && (
        <div
          className={cn(
            "rounded-lg flex items-start gap-2",
            MEDICAL_PRESENTATION.containerClass,
            pad,
          )}
          role="alert"
        >
          <MEDICAL_PRESENTATION.icon
            className={cn("mt-0.5 shrink-0", MEDICAL_PRESENTATION.iconClass, density === "compact" ? "size-4" : "size-5")}
            aria-hidden
          />
          <div className="space-y-0.5">
            <div className="font-semibold uppercase tracking-wide text-sm">Medical</div>
            <div className="text-foreground/90 leading-snug">{medicalNotes}</div>
          </div>
        </div>
      )}
      {allergies && (
        <div
          className={cn(
            "rounded-lg flex items-start gap-2",
            ALLERGY_PRESENTATION.containerClass,
            pad,
          )}
          role="alert"
        >
          <ALLERGY_PRESENTATION.icon
            className={cn("mt-0.5 shrink-0", ALLERGY_PRESENTATION.iconClass, density === "compact" ? "size-4" : "size-5")}
            aria-hidden
          />
          <div className="space-y-0.5">
            <div className="font-semibold uppercase tracking-wide text-sm">Allergies</div>
            <div className="text-foreground/90 leading-snug">{allergies}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline pill versions of the safety alerts — for the roster row where
 * we can't show the full text but still want the prominence.
 */
export function SafetyPills({
  allergies,
  medicalNotes,
}: {
  allergies: string | null | undefined;
  medicalNotes: string | null | undefined;
}) {
  if (!allergies && !medicalNotes) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {medicalNotes && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
            MEDICAL_PRESENTATION.badgeClass,
          )}
          title={medicalNotes}
        >
          <MEDICAL_PRESENTATION.icon className="size-3" aria-hidden />
          <span className="hidden sm:inline">Medical</span>
        </span>
      )}
      {allergies && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
            ALLERGY_PRESENTATION.badgeClass,
          )}
          title={allergies}
        >
          <ALLERGY_PRESENTATION.icon className="size-3" aria-hidden />
          <span className="hidden sm:inline">Allergies</span>
        </span>
      )}
    </span>
  );
}
