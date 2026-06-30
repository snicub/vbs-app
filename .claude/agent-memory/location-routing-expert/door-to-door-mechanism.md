---
name: door-to-door-mechanism
description: How door-to-door van routing works on disk — van=one zone stop carrying color+coords, address→nearest-zone suggestion, no migration. Verified 2026-06-18.
metadata:
  type: project
---

Door-to-door is LIVE on disk (verified 2026-06-18). Vans drive to each kid's HOME; no shared corner stops. Mechanism is migration-free — `stops`/`routes`/`student_day_status` view unchanged.

**Each van = ONE pickup "zone" stop.** `createVan` (`src/server-actions/vans.ts`) provisions a single `stops` row carrying the van's color + AM/PM scheduled times (`provisionVanZone`), then points BOTH the van's routes at it (`setVanRouteStops` upserts am+pm route rows with `stop_ids = [zoneId]`). `updateVan` keeps name/color/times/area-coords in sync on that zone stop.

**Van area location → zone coords.** `updateVan` takes `areaAddress` (e.g. "North Sisseton, SD"), geocodes it via the SHARED `geocodeAddress`, and writes lat/lng onto the zone stop. Empty clears it (van drops out of suggestion, manual still works); an un-geocodable address is REJECTED so a van never has an area with no coords. So the geocode helper serves BOTH families and van areas.

**Address→van suggestion = nearest van zone.** `autoAssignStopsFromAddresses` (`src/server-actions/routing.ts`) filters candidate stops to (on a van route) AND (has coords), geocodes families missing coords, and `assignStopsForMode` fills only the empty legs with the nearest zone. A full-van kid lands on ONE van (both legs same zone). Manual stops never overridden.

**Button label is "Suggest vans from addresses"** (was "Build from addresses") on the `/coordinator` Needs-routing card (`route-build-button.tsx`). It's a SUGGESTION the coordinator reviews/overrides.

Related: [[address-routing-state]], [[address-routing-gaps]]
