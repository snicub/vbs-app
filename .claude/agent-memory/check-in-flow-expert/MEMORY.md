<!-- Memory index for check-in-flow-expert. One line per memory: - [Title](file.md) — hook. -->
- [Restricted-release & pickup-name status](restricted-release-status.md) — fully server-enforced on every reachable path (0019/0022 + action pre-check; parent_pickup out of OVERRIDABLE). Residual: exact-name match only.
- [Event authorization matrix](event-authz-matrix.md) — who can write which events, where enforced, and the undo/override authz + time window.
- [Future-clock guard](future-clock-guard.md) — clampOccurredAt drops ahead-of-now occurredAt in both write paths (protects overdue-van alarms); now extracted to lib/events/occurred-at.ts + tested (solved).
- [Allergies folded into medical notes](allergy-field-folded-into-medical.md) — signup dropped the Allergies field (2026-06-17); new kids = allergies null, info in medical_notes → Medical callout. Render is null-safe.
