# Agent: Chart & Navigation

**Project:** SailboatServer — SV-Esperanza
**Domain:** Leaflet maps, MapServer WMS, NOAA ENC charts, AIS rendering, weather overlays

---

## Role

Own the chart and navigation layer: Leaflet map initialization, WMS tile layers, NOAA ENC chart rendering via MapServer, AIS vessel tracking, weather overlays, passage line display, and the tile cache warming workflow.

---

## Architecture

```
Browser (Leaflet)
  └─ L.tileLayer.wms → nginx (port 80, cached FastCGI)
       └─ fcgiwrap (4 workers) → MapServer CGI
            └─ /etc/mapserver/enc.map → /data/charts/enc_merged.gpkg
```

### Tile Cache (Critical)
- nginx FastCGI cache: `/var/cache/nginx/mapserv/` (30 days, ~500MB)
- Cache key = full WMS request URI including `bbox=` parameter
- **bbox values must come from Leaflet in a browser** — ARM64 float math differs from x86 V8 by 1-3 ULP → permanent cache miss if warmed server-side
- **Always warm via `warm.html` in Chrome on x86 Mac**
- `scripts/warm_tile_cache.py` and `warm_tile_cache.mjs` are reference only — do NOT use for live cache

---

## Key Files

| File | Purpose |
|------|---------|
| `js/sbs-chart.js` | Leaflet map, all layers, AIS, weather overlays, MOB |
| `warm.html` | Browser-based WMS tile cache warmer |
| `scripts/setup_enc_wms.py` | Rebuilds MapServer mapfile + GPKG (run on Pi) |
| `/etc/mapserver/enc.map` | MapServer mapfile (on Pi) |
| `/data/charts/enc_merged.gpkg` | Merged NOAA ENC GeoPackage, 42MB (on Pi) |
| `/data/charts/noaa_enc/` | Raw S-57 ENC files (on Pi) |

---

## sbs-chart.js — Structure

### Singleton: `SBSChart`

**Initialization:**
```javascript
SBSChart.init(containerId)   // called from portal.js on Charts tab first open
SBSChart.invalidate()        // called on tab show (map.invalidateSize())
```

**Layer Groups:**
- `LOCAL_WMS_LAYERS` — NOAA ENC via MapServer (primary nautical chart)
- ESRI Ocean Basemap — always-on background
- NOAA RNC Online — alternative base
- OpenSeaMap — always-on ATONs overlay
- OWM weather layers — wind, precip, pressure, clouds
- GRIB wind particles — leaflet-velocity animated overlay
- AIS layer — vessel targets
- Passage layer — route line, waypoint markers, boat position

**Critical rule:** Keep `LOCAL_WMS_LAYERS` in sync between `warm.html` and `sbs-chart.js`. A comment in `warm.html` flags this dependency.

### AIS Rendering
- SignalK `vessels.*` data via `SBSData`
- Rendered as `L.circleMarker` with popup: vessel name, MMSI, SOG, COG
- Updates on each SignalK delta containing vessel data

### Weather Overlays
- **OWM:** `L.tileLayer` with user-supplied API key from `localStorage`
- **GRIB/leaflet-velocity:** NOAA GFS wind data from ERDDAP, animated particles
- OWM key stored in `localStorage` key `sbs-owm-key` — never hardcoded

### MOB (Man Overboard)
- MOB button drops marker at current boat position
- Marker persists until cleared
- Also activates MOB alert via `SBSData`

---

## Helm Chart Tab (P1-01 — Pending)

**Do NOT reuse `sbs-chart.js` directly on `helm.html`.** DOM ID conflicts with `helm.js`:
- Both update `#chart-sog`, `#chart-cog`, `#chart-depth`, `#chart-tws`, `#chart-twd`, `#chart-pos`
- Different formatting (helm: large tiles; chart overlay: small pills)

**Correct approach:** Implement `HelmChart` class inside `helm.js`:
- Same Leaflet + WMS options as `sbs-chart.js`
- Standalone — no shared DOM ids with `helm.js` instrument updates
- Init on first Chart tab open, `map.invalidateSize()` on tab show

---

## MapServer / ENC Pipeline

### Rebuild Charts (on Pi)
```bash
ssh pi@sailboatserver.local
sudo python3 setup_enc_wms.py
```
Run after adding new NOAA ENC files to `/data/charts/noaa_enc/`.

### NOAA ENC Coverage
- Current coverage: Pacific Northwest (Puget Sound, San Juan Islands, Gulf Islands)
- Download new ENCs from: `https://charts.noaa.gov/ENCs/ENCs.shtml`
- Add to `/data/charts/noaa_enc/`, then rebuild

### SignalK Charts Plugin
- `/signalk/v1/api/resources/charts` may return 404 — known issue
- `sbs-chart.js` already falls back to LOCAL WMS — do not assume SK charts exist

---

## External Tile Sources

| Layer | URL Pattern | Key Required |
|-------|-------------|--------------|
| LOCAL WMS | `/cgi-bin/mapserv?...` | No |
| ESRI Ocean | `server.arcgisonline.com/.../tile/{z}/{y}/{x}` | No |
| NOAA RNC | `tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png` | No |
| OpenSeaMap | `tiles.openseamap.org/seamark/{z}/{x}/{y}.png` | No |
| OWM | `tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png` | Yes (localStorage) |
| NOAA GRIB | `coastwatch.pfeg.noaa.gov/erddap/griddap/...` | No |

---

## Vendor Libraries

```
vendor/leaflet/leaflet.js            v1.9.x
vendor/leaflet-velocity/leaflet-velocity.min.js
```
Bundled locally — no CDN dependency on boat network.
