# State machine

The Postgres function `public.record_event()` is the source of truth.
`src/lib/events/state-machine.ts` is a TS mirror used only for UI hints.

## States

```
not_started ──► van_boarded_am ──► arrived_at_site ──► site_checked_in
            ╲                                              │
             ╲                                             ▼
              parent_dropoff ─────────────────────► site_checked_out
                                                           │
                          ┌────────────────────────────────┤
                          ▼                                ▼
                   van_boarded_pm                    parent_pickup
                          │                                │
                          ▼                                ▼
                     van_offloaded_pm  ─────────►       home  (terminal)

(from not_started) ──► no_show ──► marked_no_show  (terminal except override)
```

## Events → next state

| event              | next state           |
| ------------------ | -------------------- |
| `van_boarded_am`   | `van_boarded_am`     |
| `van_offloaded_am` | `arrived_at_site`    |
| `site_checked_in`  | `site_checked_in`    |
| `parent_dropoff`   | `site_checked_in`    |
| `site_checked_out` | `site_checked_out`   |
| `van_boarded_pm`   | `van_boarded_pm`     |
| `van_offloaded_pm` | `home`               |
| `parent_pickup`    | `home`               |
| `no_show`          | `marked_no_show`     |
| `override`         | (does not change state by itself; the event carries the reason) |

## Overrides

Any event that would be an illegal transition is rejected with `P0001`
**unless** all three conditions hold:

1. Actor role is `coordinator` or `admin`
2. `override_reason` is set and non-empty
3. The function call also passes the event_type to be forced

The override event is logged and the override flag is returned to the caller.
Use this for: "kid had to leave site early," "no-show was wrong," etc.

## Corrections (supersession)

If a previous event was wrong (e.g. checked in the wrong student), the
coordinator emits a new event AND passes `p_supersedes_event_id` to mark
the predecessor as superseded. The view `student_day_status` skips
superseded events when deriving state.
