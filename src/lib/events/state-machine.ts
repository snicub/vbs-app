/**
 * Client-side mirror of the state machine enforced by public.record_event().
 * The Postgres function is authoritative — this exists for UI hints (greying
 * out buttons, suggesting next actions). Keep in sync with 0004_record_event_fn.sql.
 */

export const EVENT_TYPES = [
  "van_boarded_am",
  "van_offloaded_am",
  "site_checked_in",
  "site_checked_out",
  "van_boarded_pm",
  "van_offloaded_pm",
  "parent_dropoff",
  "parent_pickup",
  "no_show",
  "override",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const STATES = [
  "not_started",
  "van_boarded_am",
  "arrived_at_site",
  "site_checked_in",
  "site_checked_out",
  "van_boarded_pm",
  "home",
  "marked_no_show",
] as const;
export type DayState = (typeof STATES)[number];

const TRANSITIONS: Readonly<Record<DayState, readonly EventType[]>> = {
  not_started:      ["van_boarded_am", "parent_dropoff", "no_show"],
  van_boarded_am:   ["van_offloaded_am"],
  arrived_at_site:  ["site_checked_in"],
  site_checked_in:  ["site_checked_out"],
  site_checked_out: ["van_boarded_pm", "parent_pickup"],
  van_boarded_pm:   ["van_offloaded_pm"],
  home:             [],
  marked_no_show:   [],
};

const EVENT_TO_NEXT_STATE: Readonly<Record<EventType, DayState | null>> = {
  van_boarded_am:   "van_boarded_am",
  van_offloaded_am: "arrived_at_site",
  site_checked_in:  "site_checked_in",
  parent_dropoff:   "site_checked_in",
  site_checked_out: "site_checked_out",
  van_boarded_pm:   "van_boarded_pm",
  van_offloaded_pm: "home",
  parent_pickup:    "home",
  no_show:          "marked_no_show",
  override:         null,  // override can land in any state; computed elsewhere
};

const TERMINAL_STATES: ReadonlySet<DayState> = new Set<DayState>(["home", "marked_no_show"]);

export function isLegalTransition(from: DayState, event: EventType): boolean {
  if (event === "override") return true;
  const allowed = TRANSITIONS[from];
  return allowed.includes(event);
}

export function nextState(event: EventType): DayState | null {
  return EVENT_TO_NEXT_STATE[event];
}

export function legalNextEvents(from: DayState): readonly EventType[] {
  return TRANSITIONS[from];
}

export function isTerminal(state: DayState): boolean {
  return TERMINAL_STATES.has(state);
}

export function requiresOverride(from: DayState, event: EventType): boolean {
  return !isLegalTransition(from, event);
}

/**
 * Friendly labels for UI. Keep separate from the canonical enum so renames
 * here don't break SQL/parser code.
 */
export const STATE_LABEL: Readonly<Record<DayState, string>> = {
  not_started:      "Not started",
  van_boarded_am:   "On van (AM)",
  arrived_at_site:  "Arrived at site",
  site_checked_in:  "Checked in",
  site_checked_out: "Checked out",
  van_boarded_pm:   "On van (PM)",
  home:             "Home",
  marked_no_show:   "No-show",
};

export const EVENT_LABEL: Readonly<Record<EventType, string>> = {
  van_boarded_am:   "Boarded AM van",
  van_offloaded_am: "Off AM van",
  site_checked_in:  "Checked in",
  site_checked_out: "Checked out",
  van_boarded_pm:   "Boarded PM van",
  van_offloaded_pm: "Off PM van",
  parent_dropoff:   "Parent dropoff",
  parent_pickup:    "Parent pickup",
  no_show:          "No-show",
  override:         "Override",
};
