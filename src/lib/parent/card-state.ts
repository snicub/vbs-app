/**
 * Decide what a single child's card on the parent status page should show.
 *
 * Two rules a parent's safety view must get right:
 *  - A child marked NOT attending today shouldn't show the "Not arrived"
 *    pending state — that reads as an alarm to a parent whose kid is
 *    legitimately staying home. Show a calm "Not attending today" line.
 *  - BUT never hide a live custody/transit state. If a not-attending child
 *    somehow has a real event (checked in, on a van), that state wins — the
 *    parent must see where their child actually is.
 *
 * A missing day record (no status row at all — a non-VBS day, or a
 * partially-orphaned registration) is treated as "not attending" rather than a
 * false "Not arrived".
 */

import { safeDayState } from "@/lib/state-presentation";
import type { DayState } from "@/lib/events/state-machine";

export type ParentCardState =
  | { kind: "not_attending" }
  | { kind: "status"; state: DayState };

export function parentCardState(
  status: { attending: boolean; state: string } | null,
): ParentCardState {
  if (!status) return { kind: "not_attending" };
  const state = safeDayState(status.state);
  if (!status.attending && state === "not_started") return { kind: "not_attending" };
  return { kind: "status", state };
}
