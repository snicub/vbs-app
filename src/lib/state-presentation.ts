/**
 * Single source of truth for how a student's status, anomalies, and
 * medical/allergy notes are presented in the UI. Every screen reads from
 * here — never hard-code a state color or label in a component.
 *
 * Color tokens are CSS variables defined in `globals.css` so light/dark
 * mode behave consistently. To restyle a state, change the variable —
 * not the component.
 */

import {
  CircleIcon,
  BusIcon,
  MapPinIcon,
  CheckIcon,
  LogOutIcon,
  HomeIcon,
  OctagonXIcon,
  ClockIcon,
  AlertTriangleIcon,
  ActivityIcon,
  HeartPulseIcon,
  CrossIcon,
  type LucideIcon,
} from "lucide-react";

import { STATES, type DayState } from "@/lib/events/state-machine";
import type { AnomalyKind } from "@/lib/anomaly";

export type StateTone =
  | "pending"   // not arrived yet
  | "transit"   // on a van, moving
  | "arrived"   // physically at site, awaiting check-in
  | "safe"      // checked in at VBS
  | "leaving"   // heading home (checked out / on PM van)
  | "home"      // delivered home, terminal good
  | "danger";   // no-show, terminal bad

export type StatePresentation = {
  /** Short label for badges and headings. */
  label: string;
  /** One-sentence plain-English description for tooltips / parent page. */
  description: string;
  /** Lucide icon paired with this state. */
  icon: LucideIcon;
  /** Semantic tone — drives color via CSS variables. */
  tone: StateTone;
};

export function safeDayState(raw: string): DayState {
  return (STATES as readonly string[]).includes(raw)
    ? (raw as DayState)
    : "not_started";
}

export const STATE_PRESENTATION: Readonly<Record<DayState, StatePresentation>> = {
  not_started: {
    label: "Not arrived",
    description: "Waiting for pickup or drop-off.",
    icon: CircleIcon,
    tone: "pending",
  },
  van_boarded_am: {
    label: "On AM van",
    description: "On the morning van, en route to VBS.",
    icon: BusIcon,
    tone: "transit",
  },
  arrived_at_site: {
    label: "Arrived at church",
    description: "At the church, waiting to be checked in.",
    icon: MapPinIcon,
    tone: "arrived",
  },
  site_checked_in: {
    label: "At VBS",
    description: "Checked in — safe at the church.",
    icon: CheckIcon,
    tone: "safe",
  },
  site_checked_out: {
    label: "Heading home",
    description: "Checked out — leaving the site.",
    icon: LogOutIcon,
    tone: "leaving",
  },
  van_boarded_pm: {
    label: "On PM van",
    description: "On the afternoon van home.",
    icon: BusIcon,
    tone: "leaving",
  },
  home: {
    label: "Home",
    description: "Delivered home safely.",
    icon: HomeIcon,
    tone: "home",
  },
  marked_no_show: {
    label: "Absent today",
    description: "Not attending today.",
    icon: OctagonXIcon,
    tone: "danger",
  },
};

/**
 * Tailwind classnames per tone. Keep text darker than backgrounds so the
 * badge reads even when stacked over a busy roster row. We use arbitrary
 * value syntax against the CSS variable rather than the shorthand utility
 * because opacity modifiers on custom OKLCH variables don't yet round-trip
 * consistently through Tailwind v4 across all target browsers.
 */
export const TONE_CLASSES: Readonly<Record<
  StateTone,
  {
    badge: string;
    stripe: string;
    dot: string;
    icon: string;
    softBg: string;
  }
>> = {
  pending: {
    badge: "bg-muted text-muted-foreground border-border",
    stripe: "bg-transparent",
    dot: "bg-[var(--state-pending)]/40",
    icon: "text-muted-foreground",
    softBg: "bg-muted/40",
  },
  transit: {
    badge:
      "bg-[var(--state-transit)]/12 text-[var(--state-transit)] border-[var(--state-transit)]/30 dark:bg-[var(--state-transit)]/18",
    stripe: "bg-[var(--state-transit)]",
    dot: "bg-[var(--state-transit)]",
    icon: "text-[var(--state-transit)]",
    softBg: "bg-[var(--state-transit)]/8",
  },
  arrived: {
    badge:
      "bg-[var(--state-arrived)]/12 text-[var(--state-arrived)] border-[var(--state-arrived)]/30 dark:bg-[var(--state-arrived)]/18",
    stripe: "bg-[var(--state-arrived)]",
    dot: "bg-[var(--state-arrived)]",
    icon: "text-[var(--state-arrived)]",
    softBg: "bg-[var(--state-arrived)]/8",
  },
  safe: {
    badge:
      "bg-[var(--state-safe)]/12 text-[var(--state-safe)] border-[var(--state-safe)]/30 dark:bg-[var(--state-safe)]/18",
    stripe: "bg-[var(--state-safe)]",
    dot: "bg-[var(--state-safe)]",
    icon: "text-[var(--state-safe)]",
    softBg: "bg-[var(--state-safe)]/8",
  },
  leaving: {
    badge:
      "bg-[var(--state-leaving)]/15 text-[var(--state-leaving)] border-[var(--state-leaving)]/35 dark:bg-[var(--state-leaving)]/20",
    stripe: "bg-[var(--state-leaving)]",
    dot: "bg-[var(--state-leaving)]",
    icon: "text-[var(--state-leaving)]",
    softBg: "bg-[var(--state-leaving)]/8",
  },
  home: {
    badge:
      "bg-[var(--state-home)] text-white border-[var(--state-home)]",
    stripe: "bg-[var(--state-home)]",
    dot: "bg-[var(--state-home)]",
    icon: "text-[var(--state-home)]",
    softBg: "bg-[var(--state-home)]/8",
  },
  danger: {
    badge:
      "bg-[var(--state-danger)]/12 text-[var(--state-danger)] border-[var(--state-danger)]/35 dark:bg-[var(--state-danger)]/20",
    stripe: "bg-[var(--state-danger)]",
    dot: "bg-[var(--state-danger)]",
    icon: "text-[var(--state-danger)]",
    softBg: "bg-[var(--state-danger)]/8",
  },
};

export function presentationFor(state: DayState): StatePresentation {
  return STATE_PRESENTATION[state];
}

export function toneFor(state: DayState): StateTone {
  return STATE_PRESENTATION[state].tone;
}

/* ------------------------------------------------------------------ */
/* Anomalies                                                          */
/* ------------------------------------------------------------------ */

export type AnomalyPresentation = {
  label: string;
  description: string;
  icon: LucideIcon;
  /** "warn" = amber, "critical" = rose. Distinct icons for the 3 criticals. */
  tone: "warn" | "critical";
};

export const ANOMALY_PRESENTATION: Readonly<Record<AnomalyKind, AnomalyPresentation>> = {
  late_am: {
    label: "Late AM",
    description: "No AM event 45 minutes after scheduled pickup.",
    icon: ClockIcon,
    tone: "warn",
  },
  boarded_but_not_arrived: {
    label: "Van not arrived",
    description: "Boarded the AM van but no site check-in within 30 minutes.",
    icon: BusIcon,
    tone: "critical",
  },
  in_but_not_out: {
    label: "Never checked out",
    description: "Checked in at site but never checked out, past PM time.",
    icon: AlertTriangleIcon,
    tone: "critical",
  },
  pm_van_stuck: {
    label: "PM van stuck",
    description: "PM van boarded but not offloaded after 2 hours.",
    icon: ActivityIcon,
    tone: "critical",
  },
};

export const ANOMALY_TONE_CLASSES: Readonly<Record<
  "warn" | "critical",
  { badge: string; icon: string }
>> = {
  warn: {
    badge:
      "bg-[var(--anomaly-warn)]/15 text-[var(--anomaly-warn)] border-[var(--anomaly-warn)]/35",
    icon: "text-[var(--anomaly-warn)]",
  },
  critical: {
    badge:
      "bg-[var(--anomaly-critical)]/15 text-[var(--anomaly-critical)] border-[var(--anomaly-critical)]/40",
    icon: "text-[var(--anomaly-critical)]",
  },
};

/* ------------------------------------------------------------------ */
/* Safety callouts: medical + allergy                                  */
/* ------------------------------------------------------------------ */

export const MEDICAL_PRESENTATION = {
  label: "Medical alert",
  icon: HeartPulseIcon,
  /** Loud, deep rose. Higher prominence than allergy. */
  cssVar: "--medical",
  containerClass:
    "border border-[var(--medical)]/40 bg-[var(--medical)]/8 text-[var(--medical)] dark:bg-[var(--medical)]/15",
  badgeClass:
    "bg-[var(--medical)] text-white border-[var(--medical)]",
  iconClass: "text-[var(--medical)]",
} as const;

export const ALLERGY_PRESENTATION = {
  label: "Allergies",
  icon: CrossIcon,
  cssVar: "--allergy",
  containerClass:
    "border border-[var(--allergy)]/40 bg-[var(--allergy)]/10 text-[var(--allergy)] dark:bg-[var(--allergy)]/18",
  badgeClass:
    "bg-[var(--allergy)]/15 text-[var(--allergy)] border-[var(--allergy)]/40",
  iconClass: "text-[var(--allergy)]",
} as const;
