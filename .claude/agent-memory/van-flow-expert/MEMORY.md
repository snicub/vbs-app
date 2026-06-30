<!-- Memory index for van-flow-expert. One line per memory: - [Title](file.md) — hook. -->

- [Van authz & derivation](van-authz-and-derivation.md) — how van membership + driver/aide PM authz derive from stop→route→van; the 0018 smart_checkout chain.
- [Van flow known bugs](van-flow-known-bugs.md) — 2026-06-16 verified open issues: NULL-stop regression, attending filter, smart_checkout idempotency, GPS, manifest rename.
- [Offline outbox](offline-outbox.md) — van store-and-forward queue: frozen key, 0021 replay-safe, never-drop, occurred_at FIXED; SW is a KILL SWITCH so cold-open offline is dead.
- [No-login session mode](no-login-session-mode.md) — getSessionUser acts as oldest coordinator when nobody's signed in → bypasses driver/aide van authz.
- [Allergy → medical_notes](allergy-into-medical-notes.md) — new signups fold allergies into medical_notes (allergies=null); van still surfaces it loudly. Not a regression.
