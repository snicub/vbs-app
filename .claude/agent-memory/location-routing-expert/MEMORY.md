<!-- Memory index for location-routing-expert. One line per memory: - [Title](file.md) — hook. -->

- [Door-to-door mechanism](door-to-door-mechanism.md) — van=one zone stop (color+coords) on both routes; address→nearest-zone suggestion; van area geocoded too; migration-free. Verified 2026-06-18.
- [Pickup Map](pickup-map.md) — /coordinator/vans/assign visual home-pin→van manual assignment (headline feature); Suggest + Locate buttons; no-address list. Built 2026-06-27.
- [Geocode region bucketing](geocode-region-bucketing.md) — signup region dropdown (primary); localPlace is TOWN-FIRST over street; parseCoordinate; reservation-name → zone-center mapping.
- [Geocode stale-data gap](geocode-stale-data-remediation-gap.md) — a routing-logic fix does NOT re-route already-geocoded/assigned kids; remediate by hand on the pickup map.
- [Address-routing current state](address-routing-state.md) — what's built/not in the address→route layer (2026-06-16): no geocoding, no optimizer, manual stop assign + needs-routing worklist BUILT.
- [Address-routing open gaps](address-routing-gaps.md) — needsRouting def mismatch hides NULL-stop kids on the paper roster; today-scoping; haversine ETA; UTC cron.
