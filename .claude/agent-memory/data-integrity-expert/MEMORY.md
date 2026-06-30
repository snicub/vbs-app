<!-- Memory index for data-integrity-expert. One line per memory: - [Title](file.md) — hook. -->

- [Live function versions](live-function-versions.md) — which migration holds each live fn/view; smart_checkout=0022, record_event/authz=0017, view=0026, state machine=0009.
- [Student soft archive](student-soft-archive.md) — students.archived_at (0026) replaces broken hard delete; view + direct-read filters hide archived; restore via coordinator.
- [smart_checkout divergences](smart-checkout-divergences.md) — bypasses record_event; idempotent via 0021 anchor key + 0022 occurred_at; still skips per-step legality.
- [Attending-filter map](attending-filter-map.md) — which screens filter attending vs not; source of inconsistent counts.
- [Anomaly timezone bug](anomaly-timezone-bug.md) — FIXED in 0020: is_late_am / is_in_but_not_out pinned to America/Chicago (was mutable session TZ GUC).
- [NULL-stop van/color derivation](null-stop-van-color-derivation.md) — address-rework regression: van kids with null stops get null van/color/scheduled-time.
- [Append-only and locking](append-only-and-locking.md) — append-only trigger + supersede hatch; idempotency-before-lock ordering; per-(student,date) lock.
- [Offline outbox data-correctness](offline-outbox-data-correctness.md) — van offline replay dedupes fine (stable key + 0021 anchor); but occurred_at NOT threaded → offline AM anomalies mis-fire; no-login session is by-design.
- [Public registration data-integrity](public-registration-data-integrity.md) — registerFamily is a public service-role non-transactional insert chain; orphan risk (token last), retry not idempotent, no rate limit; wristband collision handling sound.
- [Door-to-door zone model](door-to-door-zone-model.md) — verified GO, no migration; one per-van zone stop on AM+PM route; gotcha: zone stop must carry event AM/PM scheduled times or is_late_am/is_in_but_not_out never fire.
- [Anomaly reachability (door-to-door event)](anomaly-reachability-doortodoor.md) — only is_boarded_but_not_arrived (AM) fires; is_pm_van_stuck UNREACHABLE (atomic smartCheckOut); late_am/in_but_not_out inert+app-suppressed; no PM "lost going home" net.
- [Door-to-door auto-assign correctness](door-to-door-auto-assign-correctness.md) — town-first nearest-zone assignment; risk = zone-stop coords not nearest own region center; safe corrective-SQL pattern (not-exists-events guard).
