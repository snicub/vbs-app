import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventType } from "@/lib/events/state-machine";
import type { UserRole, RecordEventResult } from "@/types/domain";

export type RecordEventArgs = {
  studentId: string;
  eventDate: string;             // ISO date, YYYY-MM-DD
  eventType: EventType;
  actorUserId: string | null;
  actorRole: UserRole;
  idempotencyKey: string;
  vanId?: string | null;
  stopId?: string | null;
  overrideReason?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;           // ISO timestamp; defaults to now() in the DB
  supersedesEventId?: string | null;
  /** Force the admin (service-role) client. Used by Twilio webhooks etc. */
  asAdmin?: boolean;
};

/**
 * Server-side wrapper around the public.record_event() RPC.
 * Returns either a success object or an Error — does NOT throw.
 *
 * The caller is responsible for surfacing the error to the user. The typical
 * pattern in a server action is to translate `error` to a JSON-safe object.
 */
export async function recordEvent(
  args: RecordEventArgs,
): Promise<{ ok: true; data: RecordEventResult } | { ok: false; error: string }> {
  const client = args.asAdmin
    ? createAdminClient()
    : await createClient();

  const { data, error } = await client.rpc("record_event", {
    p_student_id: args.studentId,
    p_event_date: args.eventDate,
    p_event_type: args.eventType,
    p_actor_user_id: args.actorUserId,
    p_actor_role: args.actorRole,
    p_idempotency_key: args.idempotencyKey,
    p_van_id: args.vanId ?? null,
    p_stop_id: args.stopId ?? null,
    p_override_reason: args.overrideReason ?? null,
    p_metadata: args.metadata ?? {},
    p_occurred_at: args.occurredAt ?? null,
    p_supersedes_event_id: args.supersedesEventId ?? null,
  } as never);

  if (error) {
    return { ok: false, error: error.message };
  }

  // The function returns a single row in `setof record` shape.
  type Row = {
    event_id: string;
    derived_state: RecordEventResult["derivedState"];
    was_idempotent: boolean;
    was_override: boolean;
  };
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) {
    return { ok: false, error: "record_event returned no row" };
  }

  return {
    ok: true,
    data: {
      eventId: row.event_id,
      derivedState: row.derived_state,
      wasIdempotent: row.was_idempotent,
      wasOverride: row.was_override,
    },
  };
}
