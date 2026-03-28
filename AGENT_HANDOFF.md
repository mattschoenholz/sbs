# SailboatServer — Agent Handoff Document
**Vessel:** SV-Esperanza  
**Owner:** Matt Schoenholz  
**Last Updated:** March 2026  
**Transcript:** [Full conversation history](996cd2d7-b2ce-4256-aa7d-dfea805fc139)

**Claude Code / AI agents:** Read **`CLAUDE.md`** at the repo root first (hard rules: WMS bbox warming, Helm chart vs `sbs-chart.js`, Pi 5 `lgpio`, deploy). This file is the narrative handoff; **`docs/`** is the technical deep dive.

---

## What This Project Is

A Raspberry Pi 5 mounted aboard SV-Esperanza serves as a boat computer and web server. A custom web application (the "portal") is served over the local boat network and provides:

- **Real-time instrument display** (SOG, COG, depth, wind, barometer, temp) via SignalK WebSocket
- **Interactive nautical chart** with local NOAA ENC overlay, AIS vessel tracking, and weather overlays
- **Passage planning** (waypoints, departure windows, tides, ETA, safety assessment)
- **Helm cockpit display** (full-screen, touch-optimized instrument tiles)
- **Boat control** (8-channel relay board: lights, pumps, fans via GPIO)
- **Environmental monitoring** (DS18B20 temperature sensors, bilge sensor)
- **Weather forecasting** (Open-Meteo hourly forecast, OpenWeatherMap map overlays, NOAA GFS GRIB wind)

The project is developed on a Mac in Cursor IDE and deployed to the Pi via SSH/SCP using `scripts/deploy.sh`.

---

## Infrastructure

### Raspberry Pi 5
- **OS:** Raspberry Pi OS (Debian Bookworm, arm64)
- **Hostname:** `sailboatserver.local` (local network) / `sailboatserver` (Tailscale)
- **Tailscale IP:** `100.109.248.77`
- **SSH:** `ssh pi@100.109.248.77` or `ssh pi@sailboatserver.local` (on local network)
- **Web root:** `/var/www/html/`
- **Storage:** NVMe SSD (booted from NVMe, cloned from SD card)

### Network Topology
```
Raspberry Pi → GLiNet router (192.168.42.x) → ASUS home router → Internet
```
- GLiNet router admin: `http://192.168.42.1`
- Pi is accessible on the boat network at `http://sailboatserver.local`
- Pi is accessible remotely via Tailscale at `http://100.109.248.77`

### Services on the Pi
| Service | Port | Managed By | Purpose |
|---|---|---|---|
| nginx | 80 | systemd | Serves the web portal, proxies MapServer |
| SignalK | 3000 | systemd | NMEA/instrument data hub |
| relay.service | 5000 | systemd | Python Flask API (GPIO, temps, system) |
| fcgiwrap | socket | systemd (4 workers) | Runs MapServer CGI for WMS tiles |
| tailscaled | — | systemd | Remote access VPN |

### Key Pi Paths
| Path | Contents |
|---|---|
| `/var/www/html/` | Web portal files |
| `/etc/nginx/sites-available/default` | Nginx config (caching, WMS proxy) |
| `/etc/mapserver/enc.map` | MapServer mapfile for NOAA ENCs |
| `/data/charts/enc_merged.gpkg` | Merged NOAA ENC GeoPackage (42MB) |
| `/data/charts/soundings.shp` | Depth soundings shapefile |
| `/data/charts/noaa_enc/` | Raw downloaded NOAA S-57 ENC charts |
| `/var/cache/nginx/mapserv/` | FastCGI WMS tile cache |
| `~/relay_server.py` | Flask relay API (deployed here) |
| `~/setup_enc_wms.py` | Chart rebuild script |

---

## Development Workflow

### Deploy to Pi (local network)
```bash
bash scripts/deploy.sh
```

### Deploy to Pi (remote via Tailscale)
```bash
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

### SSH to Pi
```bash
ssh pi@100.109.248.77          # via Tailscale (any network)
ssh pi@sailboatserver.local    # on local network only
```

### Rebuild nautical charts (run on Pi after adding new ENCs)
```bash
ssh pi@sailboatserver.local
sudo python3 setup_enc_wms.py
```

### Pre-warm the WMS tile cache
Open `http://sailboatserver.local/warm.html` in Chrome. Run from the user's Mac browser — this is critical because the bbox floating-point calculations must match the browser's V8 engine exactly for nginx cache keys to hit.

---

## Application Architecture

### Frontend — Two HTML pages
1. **`index.html`** — The Portal (cabin/planning view)
   - Tab 1: Manage (sub-tabs: Charts, Instruments, Weather, Passage)
   - Tab 2: Plan (sub-tabs: Overview, Windows, Tides, Fuel, Watches)
   - Global: Controls Drawer (Electrical relays, Temperatures, Network, System)
   - Clicking "Helm" tab redirects directly to `helm.html`

2. **`helm.html`** — The Helm Display (cockpit view, full-screen)
   - Tab 1: Instruments (large responsive tiles: SOG, COG, DEPTH, TWS, etc.)
   - Tab 2: Chart (placeholder — OpenCPN integration pending)
   - Tab 3: Passage (next waypoint, route list, alerts, performance)
   - Tab 4: Weather (wind gauge, barometer, 24hr forecast strip)
   - MOB (Man Overboard) button always present

### JavaScript Modules
| File | Purpose |
|---|---|
| `js/sbs-data.js` | SignalK WebSocket client, data normalization, passage tracking, alerts. Singleton `SBSData`. |
| `js/sbs-components.js` | Custom HTML elements: `<instrument-cell>`, `<wind-gauge>`, `<depth-display>`, `<compass-rose>`, `<alert-banner>`, `<night-toggle>`, `<connection-status>` |
| `js/sbs-chart.js` | Leaflet map init, chart layers (LOCAL WMS, ESRI, NOAA), AIS rendering, weather overlays (OWM, GRIB/leaflet-velocity), MOB marker. Singleton `SBSChart`. |
| `js/portal.js` | Portal-specific logic: tab/subtab switching, relay control, hotspot, temperatures, passage planning, departure windows, safety bars, weather forecasts, passage alerts, SVG route map |
| `js/helm.js` | Helm-specific logic: instrument updates, autopilot controls, passage display, weather display, MOB activation |

### CSS
| File | Purpose |
|---|---|
| `css/sbs-theme.css` | Full design system: tokens, layout, all portal components |
| `css/helm.css` | Helm-specific overrides (full-screen, large tiles, passage cards) |

### Design System
- **Font Display:** Barlow Condensed (labels, headings, nav)
- **Font Mono:** Share Tech Mono (instrument values)
- **Primary color:** Amber `#e8940a` (active instruments)
- **Secondary:** Cyan `#06b6d4` (depth, chart elements)
- **Background:** `#080c10` (void), `#0d1318` (deep), `#111920` (surface)
- Night mode: toggles all colors to amber-only (no blue light)
- Fully responsive via `clamp()` font sizes and CSS Grid auto-fill

---

## Hardware

### Raspberry Pi 5 + NVMe SSD
- 8GB RAM
- NVMe HAT with M.2 SSD (boot device)
- GPIO 40-pin header in use

### Waveshare Relay Board B (8-channel)
Active-LOW relays. Jumpers physically moved from Waveshare defaults to clear MacArthur HAT UART conflicts.
See `docs/GPIO_PIN_MAPPING.md` for full conflict history and pin justifications.
| Channel | GPIO Pin | Function |
|---|---|---|
| CH1 | 5 | Cabin Lights |
| CH2 | 6 | Navigation Lights |
| CH3 | 13 | Anchor Light |
| CH4 | 16 | Bilge Pump (SAFETY CRITICAL) |
| CH5 | 25 | Water Pump |
| CH6 | 24 | Vent Fan |
| CH7 | 18 | Instruments |
| CH8 | 17 | Starlink Power |

### ESP32 Sensor Node
Transmits via NMEA/serial to SignalK:
- Paddlewheel speed through water (STW)
- BME280 (I2C): barometric pressure, temperature, humidity
- Bilge water sensor (digital)

### DS18B20 Temperature Sensors (1-Wire)
4 sensors on GPIO19 / pin 35 (1-Wire bus, MacArthur HAT with 1.6 KΩ pull-up):
- Cabin, Engine, Exhaust, Water

### NMEA Instruments
Connected to SignalK. Mix of MacArthur HAT UART terminals and USB:
- VHF Radio (Standard Horizon SH-2150): NMEA 0183 via MacArthur HAT UART2 (GPIO4 TX / GPIO5→GPIO20 RX after jumper fix)
- TP22 Autotiller: NMEA 0183 via MacArthur HAT UART4 (GPIO12 TX / GPIO13→GPIO21 RX after jumper fix)
- GPS module: USB
- Depth sounder, wind instruments: USB/serial

---

## Key Data Flows

```
NMEA Instruments ──→ SignalK (port 3000) ──WebSocket──→ sbs-data.js ──→ All UI components
ESP32 sensors ──────→ SignalK
DS18B20 ────────────→ relay_server.py (port 5000) ──REST──→ portal.js (pollTemps)
GPIO relays ────────→ relay_server.py ──REST──→ portal.js / sbs-data.js
MapServer CGI ──────→ nginx (cached WMS) ──TileLayer──→ sbs-chart.js (Leaflet)
Open-Meteo API ─────→ portal.js (fetchWeather) ──→ weather charts, passage alerts
NOAA GFS/ERDDAP ────→ sbs-chart.js (toggleGrib) ──→ leaflet-velocity wind particles
OpenWeatherMap ─────→ sbs-chart.js (selectWxLayer) ──→ map overlays
```

---

## API Keys & Credentials

| Service | Key/Value | Location |
|---|---|---|
| OpenWeatherMap | *(user-entered via UI — never hardcode)* | Stored in browser localStorage (`sbs-owm-key`) — entered via UI prompt |
| Open-Meteo | None (free, no key) | — |
| NOAA APIs | None (free, no key) | — |
| Tailscale | Account: matt.schoenholz@ | tailscale.com/admin |

---

## Passage Planning Data Model

```javascript
passage = {
  from: 'Seattle',           // departure port name
  to: 'Victoria',            // destination name
  waypoints: [               // ordered array
    { name: 'WP1', lat: 47.6, lon: -122.3 },
    { name: 'WP2', lat: 48.4, lon: -123.3 },
  ],
  planSOG: 5.0,              // planned speed over ground (knots)
  departureTime: 1234567890, // Unix ms timestamp
  selectedWindow: 0,         // index of selected departure window
  crew: ['Skipper', 'Crew 1', 'Crew 2']
}
```
Persisted to `localStorage` key `sbs-passage`. Shared with `sbs-data.js` via `SBSData.setPassage()` for alert generation.

---

## Known Issues & Workarounds

1. **WMS tile cache keys are floating-point sensitive.** The nginx cache key is the full request URI including the `bbox=` parameter. Tile bbox values computed by Python/Node.js on ARM64 Pi differ from Chrome's V8 on x86 Mac by 1-3 ULP. Solution: always use `warm.html` (browser-based cache warmer) to populate the cache.

2. **SignalK charts plugin 404.** The SignalK charts plugin endpoint (`/signalk/v1/api/resources/charts`) returns 404. `sbs-chart.js` handles this gracefully — chart layers fall back to LOCAL WMS.

3. **fcgiwrap concurrency.** Configured to 4 workers (`/etc/systemd/system/fcgiwrap.service.d/override.conf`). MapServer is slow on first render (cold cache); subsequent hits are fast via nginx fastcgi_cache.

4. **Double-NAT remote access.** Home network is Pi → GLiNet → ASUS. Tailscale solves remote access. `deploy.sh` defaults to `sailboatserver.local`; use `PI_HOST=100.109.248.77` for remote deployment.

5. **Cache-busting.** `deploy.sh` injects `?v=<timestamp>` into all `.js` and `.css` references in HTML files. HTML itself is served with `Cache-Control: no-cache`.

---

## Conversation Transcript Reference

The full conversation that produced this codebase is at:
`/Users/mattschoenholz/.cursor/projects/Users-mattschoenholz-SailboatServer/agent-transcripts/996cd2d7-b2ce-4256-aa7d-dfea805fc139/996cd2d7-b2ce-4256-aa7d-dfea805fc139.jsonl`

Topics covered (in order):
1. Priority list implementation (MOB button, weather, NOAA tides, AIS, relay naming, cache-busting)
2. Manage sub-tab bug fix (infinite recursion)
3. Weather overlay on chart (RainViewer → OpenWeatherMap)
4. NVMe HAT installation and SD→NVMe cloning via `dd`
5. ESP32 pin configuration
6. NOAA nautical charts — local WMS setup (MapServer + fcgiwrap + GeoPackage)
7. GDAL/GeoPackage optimization for tile performance
8. nginx FastCGI caching
9. Floating-point bbox mismatch (Python/Node ARM64 vs Chrome x86) → browser-based warm.html
10. Helm tab direct navigation (bypasses intermediate screen)
11. Instruments panel redesign (helm-style responsive tiles)
12. Manage > Passage redesign (SVG route map, live status, weather alerts, leg breakdown)
13. Global Controls Drawer (electrical, temps, network, system — accessible from any tab)
14. UX architecture discussion (3-scene, dock, cabin/cockpit options)
15. Tailscale remote access setup
16. This documentation package
