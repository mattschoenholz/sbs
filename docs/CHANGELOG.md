# SailboatServer — Changelog

Changes are recorded in reverse chronological order. Each session's changes are grouped together.

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
