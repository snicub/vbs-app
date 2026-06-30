<!-- Memory index for live-map-flow-expert. One line per memory: - [Title](file.md) — hook. -->

- [Map realtime + freshness mechanics](map-realtime-mechanics.md) — Leaflet/OSM (not Mapbox), van-locations-map channel, gps-freshness 120s/600s SHIPPED, device-clock nit open.
- [GPS broadcast vs offline outbox](gps-broadcast-vs-offline-outbox.md) — GPS deliberately NOT queued (stale teleport worse than a gap); silent-failure nit in broadcast callback.
