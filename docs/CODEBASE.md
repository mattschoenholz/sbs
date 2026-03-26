# SailboatServer — Codebase Guide

All paths are relative to the workspace root (`/Users/mattschoenholz/SailboatServer/`).  
On the Pi they live in `/var/www/html/` (web files) and `~/` (scripts).

---

## Frontend HTML

### `index.html` — Portal (Cabin/Planning View)
The main web application. ~700 lines. All JavaScript and CSS are loaded with `?v=<timestamp>` cache-buster injected by `deploy.sh`.

**Structure:**
```
<body>
  <alert-banner>           ← Web component, shows MOB/anchor drag alerts
  <sbs-statusbar>          ← Top bar: boat name, position, clock, Controls toggle
  <controls-drawer>        ← Collapsible: relays, temps, network, system
  <sbs-tabs>               ← Tab bar: Manage / Plan / Helm
  <sbs-panels>
    ├── Manage panel
    │   ├── .manage-subtabs   (Charts / Instruments / Weather / Passage)
    │   └── .manage-sub x4
    │       ├── #msub-charts      ← Leaflet map container
    │       ├── #msub-instruments ← inst-tiles (SOG,COG,HDG,STW,DEPTH,TWS,TWD,AWS,AWA,BARO,TEMP,HUM,BILGE)
    │       ├── #msub-weather     ← forecast, wind chart, precip chart
    │       └── #msub-passage     ← SVG route map, live status, alerts, leg breakdown
    └── Plan panel
        ├── passage header KPIs
        ├── .plan-subtabs  (Overview / Windows / Tides / Fuel / Watches)
        └── .plan-sub x5
```

**Controls Drawer** (`#controls-drawer`):
- `#relay-grid` — populated by `buildRelays()` in portal.js
- `.cd-temps` — 4 compact temp cells (cabin, engine, exhaust, water)
- `.cd-bottom-row` — hotspot toggle, SignalK link, Relay API link, Reboot, Shutdown

**Helm tab** links directly to `helm.html` (no intermediate page):
```html
<a href="helm.html" class="sbs-tab" id="tab-helm">Helm</a>
```

---

### `helm.html` — Helm Display (Cockpit View)
Full-screen, touch-optimized. No title bar, no multi-level navigation. ~400 lines.

**Structure:**
```
<body class="helm-body">
  <alert-banner>
  .helm-topbar   ← Back button (→ index.html), clock, connection dot
  .helm-tabs     ← Instruments / Chart / Passage / Weather
  .helm-panels
    ├── #hp-instruments  ← Large instrument tiles in auto-fill grid
    ├── #hp-chart        ← Placeholder / OpenCPN embed (pending)
    ├── #hp-passage      ← Next WP panel, route list, alerts, performance
    └── #hp-weather      ← Wind gauge, barometer trend, 24hr strip
  <button #mob-btn>      ← MOB button always visible (bottom right)
```

---

## JavaScript

### `js/sbs-data.js` (534 lines) — SignalK Data Layer
**Singleton:** `const SBSData = (() => { ... })()`

**Key internal state:**
```javascript
let ws;           // WebSocket connection
let data = {};    // normalized instrument data
let vessels = {}; // AIS targets by mmsi
let passage = {}; // active passage plan
```

**SignalK subscription:** Sends subscription message on `ws.onopen` for all navigation paths. Reconnects automatically with exponential backoff.

**Unit conversions performed:**
- `m/s` → `knots` (`* 1.94384`)
- `radians` → `degrees` (`* 180/π`)
- `Pa` → `hPa` (`/ 100`)
- `K` → `°C` (`- 273.15`)

**Passage state tracking:**
- Calls `computePassageState()` on each data update
- Finds nearest waypoint, calculates bearing/distance to next WP
- Checks if WP reached (within 0.1nm by default)
- Estimates ETA to each WP based on current SOG
- Generates `passage.alerts[]` for UI consumption

**AIS handling:**
- Subscribes to `vessels.*` delta stream
- Updates `vessels` map with MMSI, position, SOG, COG, name, vesselType
- Calls `SBSChart.updateAIS(vessels)` on AIS updates

**Event bus:**
```javascript
SBSData.on('update', callback)        // fires ~1/sec when data arrives
SBSData.on('connected', callback)     // WS connected
SBSData.on('disconnected', callback)  // WS lost
```

**Public API:**
```javascript
// Data properties (direct read)
SBSData.sog        // knots
SBSData.cog        // degrees
SBSData.heading    // degrees true
SBSData.stw        // knots
SBSData.depth      // meters
SBSData.tws        // knots
SBSData.twd        // degrees
SBSData.aws        // knots
SBSData.awa        // degrees (+/- from bow)
SBSData.pressure   // hPa
SBSData.temp       // °C
SBSData.humidity   // 0-100%
SBSData.position   // {latitude, longitude}
SBSData.bilge      // boolean

// Methods
SBSData.fmt(val, decimals)         // formats number, returns '--' if null
SBSData.fmtBearing(deg)            // formats bearing with leading zeros: '045°'
SBSData.on(event, handler)         // returns unsubscribe fn
SBSData.setPassage(plan)           // update passage plan
SBSData.toggleRelay(ch, state)     // POST to relay_server
```

---

### `js/sbs-chart.js` (565 lines) — Leaflet Map
**Singleton:** `const SBSChart = (() => { ... })()`

**Initialization (`init()`):**
1. Creates Leaflet map in `#chart-container`
2. Loads base layers (ESRI Ocean, NOAA RNC, Local WMS)
3. Adds OpenSeaMap overlay
4. Creates boat marker (SVG triangle)
5. Creates AIS layer group
6. Sets up UI overlays (center-on-boat, base layer cycle, weather toggle, GRIB toggle)
7. Calls `loadSignalKCharts()` — gracefully fails if charts endpoint returns 404
8. Subscribes to `SBSData.on('update')` to move boat marker

**Base layers:**
```javascript
const layers = {
  local: L.tileLayer.wms('/cgi-bin/mapserv', {
    layers: 'DEPARE,DEPCNT,...',
    transparent: true,
    format: 'image/png',
    ...
  }),
  esri: L.tileLayer('https://server.arcgisonline.com/...'),
  noaa: L.tileLayer('https://tileservice.charts.noaa.gov/...')
}
```

**WMS URL construction:**
Leaflet's built-in `L.tileLayer.wms` handles bbox calculation. The bbox is computed by Leaflet JS in the browser — this matches the nginx cache key exactly. Do NOT recompute bbox in Python/Node for cache warming.

**OWM weather layers:**
```javascript
const wxLayers = [
  L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${key}`),
  L.tileLayer(`...precipitation_new...`),
  L.tileLayer(`...pressure_new...`),
  L.tileLayer(`...clouds_new...`),
]
```

**GRIB wind visualization:**
Fetches u/v wind components from NOAA ERDDAP, converts to `leaflet-velocity` format, creates animated particle layer.

**MOB (Man Overboard):**
```javascript
SBSChart.triggerMOB()   // drops red marker at current position, starts timer
SBSChart.clearMOB()     // removes MOB state
```

**Public API:**
```javascript
SBSChart.init()
SBSChart.update()           // redraws boat position
SBSChart.centerOnBoat()
SBSChart.cycleBaseLayer()   // cycles: local → esri → noaa → local
SBSChart.toggleWeather()
SBSChart.selectWxLayer(n)   // 0=wind, 1=rain, 2=pressure, 3=clouds
SBSChart.setWeatherApiKey()
SBSChart.toggleGrib()
SBSChart.triggerMOB()
SBSChart.clearMOB()
SBSChart.invalidateSize()   // call after drawer open/close
```

---

### `js/sbs-components.js` (542 lines) — Custom HTML Elements
Defines custom elements using the Web Components API (`customElements.define`).

| Element | Description |
|---|---|
| `<instrument-cell>` | Generic instrument tile (label + value). Attrs: `label`, `value`, `unit`, `warn` |
| `<wind-gauge>` | SVG wind direction rose with speed |
| `<depth-display>` | Depth with shallow/critical color states |
| `<compass-rose>` | Animated compass for COG/HDG |
| `<alert-banner>` | Top-of-page dismissible alert strip (MOB, anchor drag) |
| `<night-toggle>` | Moon/sun icon that toggles night mode |
| `<connection-status>` | Animated dot showing SignalK WS state |

These components are used in `helm.html` but largely replaced by direct div approach in `index.html`'s instrument tiles (for performance and simpler data binding).

---

### `js/portal.js` (1333 lines) — Portal Application Logic
The largest file. Divided into logical sections:

| Lines | Section | Key Functions |
|---|---|---|
| 1-30 | Config | `CHANNELS[]`, `RELAY_BASE` |
| 30-50 | Toast | `toast(msg, ms)` |
| 35-115 | Controls | `buildRelays()`, `allRelaysOff()`, `pollTemps()`, `toggleHotspot()`, `toggleControls()` |
| 115-155 | System | `confirmAction('reboot'/'shutdown')` |
| 132-200 | Passage CRUD | `savePassage()`, `loadPassage()`, `newPassage()`, `clearPassage()`, `renderPassage()` |
| 180-245 | Waypoints | `toggleWPForm()`, `addWaypoint()`, `removeWaypoint()`, `renderWaypoints()` |
| 230-330 | Plan calcs | `segDist()`, `calcTotalDist()`, `haversine()`, `buildDepartureWindows()`, `buildSafetyBars()`, `buildWatchSchedule()` |
| 323-395 | Sub-tab nav | `showPlanSub()`, `showManageSub()` |
| 350-510 | Passage header | `renderManagePassage()`, `drawPassageMap()` (SVG mini-map) |
| 491-620 | Live status | `renderPassageLive()` |
| 617-695 | Alerts | `buildPassageAlerts()` (cross-refs Open-Meteo forecast) |
| 693-825 | Legs | `renderPassageLegs()` |
| 822-960 | Instruments | `updateInstTiles()`, `updateSkDiag()` |
| 956-1170 | Weather | `fetchWeather()`, `renderWeather()`, `drawWindChart()`, `drawPrecipChart()` |
| 1168-1333 | Tides | `fetchTides()`, `renderTides()`, `drawTideChart()` |

**Key patterns:**
- `passage` object held in module scope, synced to `localStorage`
- Weather data cached in `localStorage` as `sbs-wx-cache` (avoids redundant API calls)
- Tide data cached as `sbs-tide-cache`
- `SBSData.on('update', ...)` listener updates instrument tiles and live passage status in real-time

**`showManageSub(id)`** — tab switching:
```javascript
function showManageSub(id) {
  // hide all .manage-sub, deactivate all buttons
  // show target sub
  if (id === 'charts')      SBSChart.ensureInit()
  if (id === 'instruments') { updateInstTiles(); updateSkDiag(); }
  if (id === 'weather')     fetchWeather()
  if (id === 'passage')     { fetchWeather(); renderManagePassage(); }
}
```

**`toggleControls()`** — Controls Drawer:
```javascript
function toggleControls() {
  _controlsOpen = !_controlsOpen
  drawer.classList.toggle('open', _controlsOpen)
  toggle.classList.toggle('open', _controlsOpen)
  arrow.textContent = _controlsOpen ? '▴' : '▾'
  setTimeout(() => SBSChart.invalidateSize(), 350) // wait for CSS transition
}
```

---

### `js/helm.js` (357 lines) — Helm Display Logic

**Initialization:** Subscribes to `SBSData.on('update', updateHelm)`.

**`updateHelm()`** — updates all instrument tile values on every data tick:
```javascript
function updateHelm() {
  const d = SBSData
  setTile('sog', d.fmt(d.sog,1), 'kn')
  setTile('cog', d.fmtBearing(d.cog), '°')
  // ... all other instruments
  updateDepthWarning(d.depth)
  updatePassagePanel(d)
}
```

**Passage panel** (`updatePassagePanel(d)`):
- Shows next waypoint name, bearing, distance
- Updates SOG performance vs. planned SOG
- Calculates revised ETA
- Shows weather alerts from `SBSData.passage.alerts`

**Weather panel** (`updateHelmWeather()`):
- Reads `wxData` from localStorage (`sbs-wx-cache`)
- Renders current conditions, wind trend bar, 24hr forecast strip

**MOB button:**
```javascript
document.getElementById('mob-btn').addEventListener('click', () => {
  SBSChart.triggerMOB()
  // show confirmation banner
})
```

---

## Backend Python

### `relay_server.py` (643 lines) — Flask API Server
Runs as `relay.service` on the Pi. Deployed to `~/relay_server.py` by `deploy.sh`.

**Sections:**
| Lines | Section |
|---|---|
| 1-80 | Config: `RELAY_PINS`, `RELAY_NAMES`, `SWITCH_PINS`, `TEMP_SENSORS` |
| 80-160 | GPIO init via lgpio |
| 160-230 | Manual override switch polling thread |
| 230-310 | `/relay/status` GET, `/relay/<ch>/on` POST, `/relay/<ch>/off` POST |
| 310-370 | `/temperatures` GET — reads DS18B20 via 1-Wire sysfs |
| 370-430 | `/hotspot/status`, `/hotspot/on`, `/hotspot/off` — hostapd control |
| 430-500 | `/system/reboot`, `/system/shutdown` — subprocess calls |
| 500-580 | GL.iNet router control via Paramiko SSH (for future use) |
| 580-643 | Flask app entry point |

**Important:** Relay is active-LOW. In code:
```python
lgpio.gpio_write(h, pin, 0)  # ON (relay energized)
lgpio.gpio_write(h, pin, 1)  # OFF (relay released)
```

---

## Scripts

### `scripts/deploy.sh`
One-command deployment. Run from Mac:
```bash
bash scripts/deploy.sh                        # local network
PI_HOST=100.109.248.77 bash scripts/deploy.sh  # via Tailscale
```
Steps: Test SSH → SCP files to /tmp → sudo cp to web root → inject cache-bust version → deploy relay_server.py → restart relay.service → verify.

### `scripts/setup_enc_wms.py`
Run on Pi to rebuild the NOAA chart pipeline after adding new ENCs.

1. Downloads any new ENCs from NOAA FTP (or uses existing in `/data/charts/noaa_enc/`)
2. Merges all S-57 layers into `/data/charts/enc_merged.gpkg` via ogr2ogr
3. Creates spatial indexes on all layers
4. Extracts SOUNDG (soundings) to `/data/charts/soundings.shp`
5. Writes `/etc/mapserver/enc.map` mapfile
6. Restarts nginx

Run with: `sudo python3 setup_enc_wms.py`

### `warm.html`
Browser-based WMS tile cache warmer. Open in Chrome on Mac.

- Generates tile grid for zoom levels 8-14, 500nm radius around boat position
- Fetches each WMS tile URL using `fetch()` — same V8 floating-point math as production map
- Shows progress bar and cache hit/miss statistics
- Must be run on the same browser that will view the charts (or any Chrome on x86)

### `scripts/warm_tile_cache.py` / `warm_tile_cache.mjs`
Earlier attempts at server-side cache warming. **Do not use** — they produce different floating-point bbox values than the browser due to ARM64 vs x86 FP differences. Kept for reference.

### `scripts/make_offline_tiles.py`
Script to download NOAA RNC/BSB raster tiles for offline use. Creates MBTiles file. Currently generates `pnw_noaa.mbtiles` (20KB, incomplete). Needs work.

---

## CSS

### `css/sbs-theme.css` — Design System
All portal styles. Organized sections:

1. **CSS variables** (`:root`) — colors, spacing, typography tokens
2. **Reset + base** — box-sizing, scrollbar, selection
3. **Layout** — `.sbs-statusbar`, `.sbs-tabs`, `.sbs-panels`, `.sbs-panel`
4. **Controls Drawer** — `.controls-toggle`, `.controls-drawer`, `.cd-*`
5. **Manage sub-panels** — `.manage-subtabs`, `.manage-sub`
6. **Instrument tiles** — `.inst-section-label`, `.inst-tiles`, `.inst-tile` (+ depth/bilge states)
7. **Chart overlay** — `.map-overlay-*` buttons
8. **Passage panel** — `.pass-map-grid`, `.pass-route-svg`, `.pass-live-*`, `.pass-alert-row`, `.pass-leg`
9. **Plan panel** — `.plan-kpi`, `.plan-subtabs`, waypoint table, departure windows, safety bars
10. **Components** — `.sbs-card`, `.relay-btn`, resource links, toast
11. **Night mode** — `body.night-mode` overrides for amber-only palette
12. **Responsive** — `@media` queries for phone/tablet breakpoints

### `css/helm.css` — Helm Overrides
Overrides and extends `sbs-theme.css` for full-screen cockpit use:
- Full-viewport layout with `height: 100dvh`
- Larger base font size
- `.helm-topbar`, `.helm-tabs`, `.helm-panels` layout
- `.helm-tile` (very large instrument value display)
- MOB button styling
- Night mode modifications for helm

---

## Other Files

### `docs/GPIO_PIN_MAPPING.md`
Pin-by-pin reference for the Waveshare relay board, ESP32 sensor connections, DS18B20 1-Wire bus, and manual override switches.

### `sv_esperanza_sensors.yaml`
SignalK plugin configuration for the ESP32 sensor node. Defines NMEA sentence parsing rules for paddlewheel, BME280, and bilge sensor data.

### `starlink_endpoints.py`
Starlink dishy local API endpoint constants used by `relay_server.py` for status checking.

### `nmea_client.h`
C++ header for Arduino/ESP32 NMEA sentence construction (used in ESP32 firmware, not on Pi).

### `package.json`
Minimal Node.js config used for running `warm_tile_cache.mjs` on the Pi. Not a full Node project.

### `requirements.txt`
Python dependencies for `relay_server.py`. Install with:
```bash
sudo pip3 install -r requirements.txt --break-system-packages
```

### `archive/`, `*_legacy.html`, `*_old.html`, `*_standalone.html`
Old versions kept for reference. Not deployed.
