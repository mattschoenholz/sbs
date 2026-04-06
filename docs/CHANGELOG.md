# SailboatServer — Changelog

Changes are recorded in reverse chronological order. Each session's changes are grouped together.

---

## Session: 2026-04-06/07 — MapLibre Vector Charts, ENC Pipeline Overhaul

### New: `web/chart-test.html` — MapLibre GL Vector Chart Page

Full replacement of the WMS/Leaflet chart approach with a **MapLibre GL JS v4 + PMTiles** vector tile renderer.

**Architecture:**
- MapLibre GL JS v4 renders vector tiles directly from a single `enc.pmtiles` file on the Pi
- PMTiles served via `pmtiles-worker.js` using HTTP range requests — no tile server needed
- ESRI Ocean Basemap as raster underlay (`World_Ocean_Base`)
- ESRI Ocean Reference labels overlay (fades out at zoom 10–13, gone by zoom 13) for water body names at low zoom
- nginx proxy cache for ESRI tiles: `/tiles-esri/` prefix, 2GB cache, 90-day TTL — dramatically improves load time on slow boat internet

**"Unimplemented type: 4" fix (MapLibre font/glyph system bypassed):**
- Protomaps font PBFs contain wire type 4 (deprecated "End Group") which MapLibre v4 rejects
- Solution: removed glyphs entirely from map style; all text/labels rendered via **canvas-drawn icon images** registered lazily via `map.on('styleimagemissing', ...)`
- Depth soundings: `makeDepthImage()` draws each unique depth value on an HTML Canvas, converts metres → feet, returns raw pixel data — zero font dependency

**Performance improvements:**
- `maxTileCacheSize: 800` — keeps 800 tiles in GPU memory, prevents eviction when panning
- `fadeDuration: 0` — tiles appear instantly, no fade-in flicker
- `transformRequest` hook rewrites ESRI tile URLs to local nginx proxy
- ESRI tiles now served from Pi LAN at LAN speed after first fetch

**ENC layers rendered** (23 S-57 layers):
| Layer | Display |
|-------|---------|
| DEPARE | Depth area fill (shallow=cyan, mid=blue, deep=navy) |
| DEPCNT | Depth contour lines |
| LNDARE | Land fill (transparent — ESRI basemap shows through) |
| COALNE | Coastline |
| WRECKS / OBSTRN / UWTROC | Colored point markers (red/orange/grey) |
| SLCONS / DRGARE | Shoreline / dredged area |
| BOYLAT | Port (red) / starboard (green) lateral buoys |
| BOYCAR / BOYSAW / BCNLAT / BCNCAR | Cardinal, safewater, beacon markers |
| TSSLPT / TSSRON / TRAFIC | Traffic separation — grey fill |
| FAIRWY | Fairway — dashed blue line |
| AIRARE | Seaplane area — amber outline |
| ACHARE | Anchorage — purple outline |
| RESARE | Restricted area — red outline |
| SOUNDG | Depth soundings in feet (canvas icons, minzoom 10) |

**Depth soundings in feet:**
- Converted from metres (S-57 native) to feet at render time
- Canvas icon: 28×16px, dark blue text with white stroke for contrast
- `symbol-sort-key` on DEPTH ensures shallower soundings render on top
- `icon-allow-overlap: false` — auto-spaced, not cluttered

### Updated: `scripts/rebuild_pmtiles.sh`

- **Root cause of 7-hour runaway**: `--extend-zooms-if-still-dropping` was overriding `--maximum-zoom=16`, causing tippecanoe to generate tiles to zoom 18+ and a 3.1GB mbtiles that never finished
- **Fix**: Hard cap `--maximum-zoom=14`, removed `--extend-zooms-if-still-dropping`
- Expanded from 9 layers to **23 S-57 layers** (added all buoy, beacon, traffic, fairway, seaplane, anchorage, restricted area layers)
- Added `--no-tile-size-limit` to prevent feature dropping in dense polygon areas
- Added `set -eo pipefail` with `|| true` on ogr2ogr calls — empty layers no longer abort the build

### New: `scripts/overnight_enc_update.py`

Automated overnight chart data pipeline:

1. **Parses NOAA ENC product catalogs** (WA, OR, AK XML catalogs) — finds all chart IDs
2. **Downloads missing NOAA ENC charts** — checks before downloading, skips already-installed
3. **Attempts CHS Canadian charts** — list of BC coastal chart IDs hardcoded; all URL patterns tried (gc.ca endpoints are not publicly downloadable — manual download required from charts.gc.ca)
4. **Rebuilds OGR VRT** — unions all installed .000 files per layer, now covers all 23 layers
5. **Rebuilds soundings.geojson** — extracts SOUNDG MULTIPOINT geometries from each .000 file using GDAL Python bindings; each sub-point Z value = depth in metres
6. **Runs rebuild_pmtiles.sh** — full PMTiles rebuild from extracted GeoJSONL

### nginx — ESRI Tile Proxy Cache

Added to `/etc/nginx/nginx.conf` and `/etc/nginx/sites-enabled/default`:
- `proxy_cache_path /var/cache/nginx/esri_tiles levels=1:2 keys_zone=esri_tiles:10m max_size=2g inactive=90d`
- Two location blocks: `/tiles-esri/Ocean/World_Ocean_Base/` and `/tiles-esri/Ocean/World_Ocean_Reference/`
- `proxy_cache_valid 200 90d` — tiles cached 90 days
- `add_header X-Tile-Cache "$upstream_cache_status"` — HIT/MISS visible in devtools
- Key discovery: `sites-enabled/default` is a regular file (not a symlink to `sites-available/default`) — must be copied explicitly when updating

### OGR VRT Layer Coverage Expanded

Regenerated `/data/charts/enc_all.vrt` on Pi from 89 installed ENC files × 23 layers (was 10 layers). `overnight_enc_update.py` `rebuild_vrt()` updated to match rebuild_pmtiles.sh layer list.

### Pending: Canadian (CHS) Charts

CHS ENC charts for BC coastal waters (Strait of Georgia, Gulf Islands, Haro Strait, Vancouver Island) are not auto-downloadable. Manual download required from:
https://www.charts.gc.ca/ → download ZIP per chart → extract to `/data/charts/noaa_enc/<chart_id>/ENC_ROOT/<chart_id>/<chart_id>.000` then run `overnight_enc_update.py`

---

## Session: 2026-04-04 / 2026-04-05 — TP22 Autopilot, BME680 BSEC2, INA226 Shunt

### New: TP22 Autotiller NMEA Bridge (`server/tp22_nmea.py`)
- New asyncio daemon subscribing to Signal K navigation paths via WebSocket
- Sends APB + RMB sentences at 1 Hz to `/dev/ttyOP_tp22` (UART4, 4800 baud)
- Two modes: **route** (SK active waypoint → derives bearing/XTE from SK data) and **manual** (portal-commanded heading → virtual waypoint 10nm out)
- Priority: route > manual > silence
- HTTP API on port 5002 (localhost only):
  - `GET  /state` → `{mode, engaged, heading}`
  - `POST /engage` → `{heading?}` — engages manual mode at current or specified heading
  - `POST /adjust` → `{delta}` — adjusts heading ±1°/±10°
  - `POST /disengage` — stops manual mode
- Deployed to `/home/pi/tp22_nmea.py`; systemd service `tp22-nmea.service` (uses `/home/pi/renogy-venv/bin/python3`)

#### Dock Test Results (2026-04-04)
- TP22 confirmed entering Nav mode with APB + RMB at 1 Hz from Pi
- Original UART4 wire orientation is correct — do not swap
- Button sequence: Auto → Engaged in portal → Nav on TP22
- Tiller deflects toward commanded bearing; returns to neutral when data stops
- Two-beep dropout = malformed/missing sentences (most often the `$` prefix eaten by shell quoting)

### relay_server.py — Autopilot Proxy Routes
Added four routes forwarding to `tp22_nmea.py` HTTP API on port 5002:
- `POST /autopilot/heading/engage`
- `POST /autopilot/heading/adjust`
- `POST /autopilot/heading/disengage`
- `GET  /autopilot/heading/state`

### Helm UI — Autopilot Controls Wired to Real API
- STBY/ENGAGED toggle calls `POST /autopilot/heading/engage` or `/disengage` via relay_server
- ±1° and ±10° heading adjustment buttons call `POST /autopilot/heading/adjust`
- Heading readout in UI reflects live server state

### ESPHome — BME680 BSEC2 (replaces BMP280/BME280)
- **Background:** BMP280 likely destroyed in 12V INA226 wiring incident (see LESSONS_LEARNED §22); ESP32 also replaced
- Changed platform from `bme280_i2c` → `bme68x_bsec2_i2c` with Bosch BSEC2 library
- New sensors exposed:
  - Barometric Pressure (hPa)
  - Air Temperature — BME680 (°C)
  - Relative Humidity — BME680 (%)
  - Air Quality IAQ (0–500 index)
  - CO₂ Equivalent (ppm)
  - VOC Equivalent (ppm)
  - IAQ Accuracy (text: "Unreliable" → "Low" → "Medium" → "High"; calibrates over hours)
- Sample rate: LP mode (every 3 s); calibration state saved to flash
- New top-level `bme68x_bsec2_i2c:` component block with `model: bme680`, `supply_voltage: 3.3V`
- **Firmware compiled and flashed via USB** to new ESP32 (MAC `6c:c8:40:89:f0:60`)

### ESPHome — INA226 Shunt Config Updated
- `ina226_shunt_resistance`: `"0.002"` → `"0.00075"` (100A/75mV marine shunt = 0.00075Ω)
- `ina226_max_current`: `"20.0"` → `"100.0"` A

### Hardware Changes (boat)
- **New ESP32** installed — original destroyed in 12V INA226 incident
- **BME680** installed (replacing destroyed BMP280) — wired to same I2C pins (GPIO21/22)
- **INA226** rewired to 100A/75mV marine shunt: VIN+ and VIN- to the small measurement terminals (millivolt differential only); no full battery voltage across the chip

### Documentation
- `docs/LESSONS_LEARNED.md` §21 — TP22 wiring and nav mode results
- `docs/LESSONS_LEARNED.md` §22 — INA226 wiring hazard (12V destruction incident, correct marine shunt wiring)

---

## Session: 2026-03-29 — GPIO Reorganization, BH1750 Sensor, Watch Firmware, Pacific Library

### ESP32 Firmware Changes

#### BH1750FVI Ambient Light Sensor
- Added to the shared I2C bus (GPIO21/22, address `0x23`)
- Reports lux every 10s via Home Assistant and `$IIXDR,L,...,Illuminance` NMEA to SignalK (`environment.outside.illuminance`)
- New substitutions: `bh1750_address`, `bh1750_update_interval`
- New global: `g_lux`
- Wiring: VCC → 3.3V (module has onboard regulator; I2C lines are 3.3V safe), ADDR → GND for address 0x23
- **Physical work pending:** sensor must be added to ESP32 protoboard at the boat

#### SW4 / SW5 Physical Switches Routed to ESP32
- SW4 (Cabin Lights) → ESP32 GPIO32, on_press POSTs `{"action":"toggle"}` to `/api/relay/1`
- SW5 (Vent Fan) → ESP32 GPIO33, on_press POSTs `{"action":"toggle"}` to `/api/relay/6`
- Uses `http_request` component with `request_headers` (ESPHome 2026.2.4 syntax)
- **Physical work pending:** wire switches to ESP32 GPIO32/33 at the boat

### GPIO Pin Reorganization — MAIANA AIS Ready

All relay and switch pins reorganized to permanently free GPIO14/15 for MAIANA AIS UART0.
No further pin moves required when MAIANA arrives.

| Change | Detail |
|--------|--------|
| CH1 relay moved → GPIO22 (pin 15) | freed GPIO14 for MAIANA UART0 TX |
| CH3 relay moved → GPIO23 (pin 16) | freed GPIO15 for MAIANA UART0 RX |
| SW2 (Nav Lights) → Pi GPIO26 (pin 37) | |
| SW3 (Anchor Light) → Pi GPIO27 (pin 13) | |
| SW4/SW5 → ESP32 GPIO32/33 | frees all remaining Pi header pins |

`relay_server.py` updated: `RELAY_PINS[1]=22`, `RELAY_PINS[3]=23`, `SWITCH_PINS` updated.
`docs/GPIO_PIN_MAPPING.md` comprehensively rewritten with full 40-pin header map.
**Physical work pending:** move relay board jumpers CH1/CH3 and wire all 5 switches at the boat.

### Watch Firmware — `watch/` Directory Scaffolded

New directory: `watch/` — Waveshare ESP32-S3-Touch-AMOLED-2.06 (240×536 AMOLED, touch)

| File | Purpose |
|------|---------|
| `watch/src/main.cpp` | Full Arduino skeleton — WiFiMulti, SignalK WS, relay HTTP API, LVGL |
| `watch/platformio.ini` | PlatformIO build config — ESP32-S3, Arduino, LVGL 9.x, ArduinoJson, WebSockets |
| `watch/lv_conf.h` | LVGL config — 240×536, Montserrat 14/24/36/48, tileview enabled |

**Three modes (auto-switch + swipe):**
- `MODE_AUTOPILOT` — ±1°/±10° heading adjust, engage/disengage button
- `MODE_INSTRUMENTS` — SOG, COG, STW, depth, TWS, TWA, battery, current (2-column tiles)
- `MODE_ANCHOR` — relay toggle buttons for all 8 channels, SOG anchor-drag warning

**Auto-switching logic:**
- AP engaged → autopilot mode
- SOG > 0.5 kn + AP off → instruments
- SOG < 0.3 kn for 60s → anchor mode

**Connectivity:** WiFiMulti tries SV-Esperanza first, falls back to phone hotspot.
SignalK WebSocket subscribes to all nav/wind/depth/battery/AP paths.
Relay HTTP API: `POST /api/relay/<ch>` with `{"action":"toggle"|"on"|"off"}`.

**Pending:** display driver init for RM67162 AMOLED via QSPI (see Waveshare Arduino demo); marked with `TODO` in `initDisplay()`.

### Shared Secrets — `scripts/gen_watch_secrets.py`

- Reads `esphome/secrets.yaml` and generates `watch/src/secrets.h` (git-ignored)
- Maps: `wifi_ssid/password` → `WIFI_SSID_BOAT/WIFI_PASS_BOAT`, `phone_hotspot_ssid/wifi_password` → `WIFI_SSID_PHONE/WIFI_PASS_PHONE`, `ota_password` → `OTA_PASSWORD`
- Single source of truth: edit `esphome/secrets.yaml`, re-run script
- Added `phone_hotspot_ssid` and `phone_hotspot_wifi_password` keys to `esphome/secrets.yaml`
- Run: `python3 scripts/gen_watch_secrets.py`

### Documentation / Process
- **CLAUDE.md** — Added Lesson #2: preferred ESP32 OTA development workflow via Pi over Tailscale
- **`scripts/deploy.sh`** — Fixed OTA hint: `python3 -m esphome run ... --no-logs`
- Remote OTA confirmed working: ESP32 flashed via `ssh pi@100.109.248.77` over Tailscale

### Pacific Sailing Library (Pi)
- `scripts/download_pacific_library.sh` written and run on Pi
- Downloads: Chapman's, Bowditch Vol 1 & 2, Pub 120 (International Code of Signals), and other passage planning resources to `/var/www/html/docs/pacific/`
- NGA publications 122–125 (Sailing Directions Enroute) and 105–106 (Pilot Charts) require manual portal download from msi.nga.mil — portal-only, cannot be automated
- RAG indexer re-run after downloads: `nohup python3 ~/index_docs.py > ~/index_docs.log 2>&1 &`

### Files Changed
| File | Change |
|------|--------|
| `esphome/sv_esperanza_sensors.yaml` | BH1750FVI sensor, SW4/SW5 switches, http_request component |
| `esphome/secrets.yaml` | Added phone hotspot keys (git-ignored) |
| `server/relay_server.py` | RELAY_PINS CH1→22, CH3→23; SWITCH_PINS updated for SW1/2/3 Pi, SW4/5 removed |
| `docs/GPIO_PIN_MAPPING.md` | Full rewrite — 40-pin header map, MAIANA status, resolved conflicts table |
| `CLAUDE.md` | Added Lesson #2 — ESP32 OTA workflow |
| `scripts/deploy.sh` | Fixed OTA flash hint |
| `scripts/gen_watch_secrets.py` | New — generates watch/src/secrets.h from esphome/secrets.yaml |
| `watch/src/main.cpp` | New — watch firmware scaffold |
| `watch/platformio.ini` | New — PlatformIO build config |
| `watch/lv_conf.h` | New — LVGL configuration |
| `.gitignore` | Added watch/src/secrets.h, watch/.pio/ |

---

## Session: 2026-03-27 — Library Page, AI Assistant, Instruments Polish

### New Features

#### Library Page (`library.html`, `css/library.css`, `js/library.js`)
- **New 4th nav page** — `LIBRARY` added to bottom nav via `SBSNav.PAGES` in `sbs-components.js`
- Sections: AI Assistant (top), Offline Library (Kiwix), Navigation References, Engine & Systems, Audiobooks, Admin
- Controls tab renamed → **SYSTEMS**

#### Offline AI Assistant (Option B — Ollama + custom chat panel)
- **Ollama `v0.18.3`** installed on Pi 5 via official installer script (`/usr/local/bin/ollama`)
- **`phi4-mini:latest`** (3.8B, Q4_K_M, 2.5 GB) pulled to `/usr/share/ollama/.ollama/models/`
- systemd service: `ollama.service` — auto-starts, restarts on crash
- **nginx proxy** at `/ollama/` → `http://127.0.0.1:11434/` with `proxy_buffering off` and 300s timeout (required for streaming)
- **CORS fix**: `OLLAMA_ORIGINS=*` set via `/etc/systemd/system/ollama.service.d/override.conf` — without this, browser requests with an `Origin` header get HTTP 403
- Chat panel features: streaming token output, typing indicator, 6 quick-prompt buttons, auto-resizing textarea, Enter to send / Shift+Enter for newline
- **System prompt**: tuned for sailing — COLREGS, Bowditch, Pub. 229, celestial nav, engine troubleshooting, first aid, NMEA data interpretation
- **Live boat context injection**: before every message, a `VESSEL STATE` block is prepended invisibly to the user text. Includes: UTC time, position, SOG/COG/heading, wind (kt + compass direction), depth (ft), barometer (hPa), air/cabin/engine/water temps (°F), active passage summary

#### Kiwix Offline Library
- **`kiwix-tools`** installed via apt; **`kiwix-serve`** running on port 8080
- systemd unit: `kiwix.service` — `ExecStart=/usr/bin/kiwix-serve --port=8080 /home/pi/zims/*.zim`
- **29 ZIM files** loaded from SD card backup, stored at `/home/pi/zims/`
  - 2 corrupted ZIMs (security.stackexchange, wikispecies) moved to `/home/pi/zims-bad/`
- **Kiwix collection cards** are now clickable `<a>` tags linking directly to each ZIM by its Kiwix path prefix (e.g. `/wikipedia_en_all_nopic_2025-12`)
- Added cards for: Outdoors, Medicine, Water Treatment, Food Preparation, Post-Disaster (previously missing)
- **↺ REINDEX button** — calls `POST /system/restart-kiwix` on relay_server. Use after dropping new ZIM files into `/home/pi/zims/`. Sudoers entry at `/etc/sudoers.d/kiwix-restart` grants pi passwordless `systemctl restart kiwix`

#### Autoindex Styling
- nginx `sub_filter` injects a dark-theme `<style>` block into all `/docs/` directory listings
- Dark background (`#0d1117`), blue links, clean monospace font — matches SBS aesthetic

### Bug Fixes / Polish
- **Instruments grid fills full width** — replaced `auto-fill minmax(130px)` with explicit breakpoints: 2 cols → 3 cols (480px) → 4 cols (720px) → 5 cols (960px)
- **Night mode button compact** — `night-toggle .sbs-btn` given reduced padding so it fits the 44px topbar without overflowing
- **Plan map zoom** — map no longer zooms out on every waypoint add; `fitBounds` only fires when route first gets 2 waypoints (`wps.length === 2`)
- **Waypoint hazard markers** — red circle markers when WMS `GetFeatureInfo` detects WRECKS, UWTROC, or OBSTRN within ~200m of a waypoint. Async check runs on add, drag, and initial load
- **Helm page passage** — passage planned on Nav Station now appears on Helm chart and Passage tabs. Root cause: `SBSData.setPassage()` was only called in `portal.js`. Fix: load `sbs-passage` from localStorage at Helm startup
- **Helm weather strip** — replaced fake `sin()` data with Open-Meteo Forecast + Marine API (ocean currents, wave height). 30-min localStorage cache. Strip shows wind (kt + direction), current (kt + direction, cyan), wave height. NOW slot highlighted. Waypoint ETA labels shown when passage active
- **All temperatures → Fahrenheit** — `sbs-data.js` `kToF` conversion; DS18B20 reads `fahrenheit` property from relay API; instrument tiles, helm strip, SK diagnostics all updated
- **Library 404 fix** — `deploy.sh` had hardcoded file list missing `library.html`, `css/library.css`, `js/library.js`. All three added to scp upload lines, remote sudo cp lines, and cache-bust sed line
- **relay_server.py CH3 GPIO pin** — corrected from GPIO 15 → GPIO 13 (hardware jumper physically at GPIO13)

### Infrastructure Changes (Pi)
- **nginx** — added locations: `/ollama/` (proxy), `/docs/` autoindex with sub_filter styling; fixed duplicate location block from previous sed accident
- **Ollama service override** — `/etc/systemd/system/ollama.service.d/override.conf` sets `OLLAMA_ORIGINS=*`
- **Sudoers** — `/etc/sudoers.d/kiwix-restart`: `pi ALL=(ALL) NOPASSWD: /bin/systemctl restart kiwix`; also fixed pre-existing bad permissions on `/etc/sudoers.d/sailboatserver`
- **SD card recovery** — 15 PDFs copied from SD card (`/media/pi/rootfs1/var/www/html/pdfs/`) → `/var/www/html/docs/books/` and `/docs/engine/`; 87GB of ZIM files rsync'd to `/home/pi/zims/` (~80 min at 18 MB/s)

### Files Changed
| File | Type |
|------|------|
| `library.html` | New page |
| `css/library.css` | New stylesheet |
| `js/library.js` | New — Kiwix check, audio browser, AI chat, boat context |
| `js/sbs-components.js` | PAGES array: added Library, renamed Controls→Systems |
| `js/sbs-data.js` | kToF conversion; DS18B20 fahrenheit property; position/passage getters |
| `js/helm.js` | Passage from localStorage; real weather fetch (Open-Meteo + Marine) |
| `js/portal.js` | fitBounds fix; hazard check; Fahrenheit thresholds; resource link cleanup |
| `css/sbs-theme.css` | inst-tiles breakpoints; night-toggle compact |
| `css/helm.css` | Weather strip current/wave/now styles |
| `index.html` | Temp unit °F; Controls→Systems label; removed broken resource links |
| `helm.html` | Temperature label °F |
| `relay_server.py` | CH3 GPIO fix; `/system/restart-kiwix` endpoint |
| `scripts/deploy.sh` | Added library.html/css/js to scp and sudo cp lines |

---

## Session: 2026-03 (prior) — Core Build

_(See git log for earlier changes. Key milestones: WMS tile cache, ESPHome sensors, AIS overlay, passage planning, relay control, DS18B20 temps, NVMe migration.)_
