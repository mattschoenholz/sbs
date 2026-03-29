# SailboatServer — Pending Work & Roadmap

Status as of 2026-03-29. Items ordered by priority.

---

## 🔴 Immediate — Physical Work at the Boat (Today, 2026-03-29)

### Relay Board Jumper Moves
Move 2-pin header jumpers on the Waveshare Relay Board B (no soldering needed):
- **CH1:** move jumper to **GPIO22 (pin 15)**
- **CH3:** move jumper to **GPIO23 (pin 16)**

Both changes are already in `relay_server.py` and `GPIO_PIN_MAPPING.md`. Deploy `relay_server.py` after the jumper moves:
```bash
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

### Switch Wiring
Wire all 5 manual override switches (one leg → GPIO pin, other leg → GND):

| Switch | Wire to | Controls |
|--------|---------|---------|
| SW1 | Pi pin 38 (GPIO20) | CH4 Bilge Pump ← SAFETY CRITICAL |
| SW2 | Pi pin 37 (GPIO26) | CH2 Nav Lights |
| SW3 | Pi pin 13 (GPIO27) | CH3 Anchor Light |
| SW4 | ESP32 GPIO32 | CH1 Cabin Lights |
| SW5 | ESP32 GPIO33 | CH6 Vent Fan |

### BH1750FVI Light Sensor
Add to ESP32 protoboard (I2C shared bus — same plug as BMP280/AHT20):
- VCC → 3.3V
- GND → GND
- SDA → GPIO21
- SCL → GPIO22
- ADDR → GND (address 0x23)

Firmware already includes it and is flashed. Power cycle ESP32 after wiring — sensor will appear in ESPHome logs and SignalK.

### Verify After Physical Changes
1. Test each relay via Systems page — all 8 channels
2. Test SW1–SW3 (Pi GPIO) and SW4–SW5 (ESP32 HTTP toggle)
3. Check SignalK for `environment.outside.illuminance` from BH1750
4. Confirm bilge pump manual override (SW1) is functional — safety critical

---

## 🔴 Immediate — Physical Installation (Pre-existing)

### Connect Remaining Hardware
- Connect NMEA 0183 instruments to SignalK (GPS, wind transducer, depth sounder)
- Verify relay channels match `GPIO_PIN_MAPPING.md`
- Test each relay manually via the Systems page

### Starlink / BoonDocker Dishy Dualie DC Power
- Install BoonDocker DC power supply for Dishy
- Power up Starlink and verify internet connectivity
- Verify `relay_server.py` Starlink status endpoint returns valid data
- Test Tailscale remote access over Starlink IP

---

## 🔴 High Priority — Software (Next Sessions)

### RAG (Retrieval Augmented Generation) for AI Assistant
The AI assistant currently has no access to your actual PDF library — it only knows what was in phi4-mini's training data. RAG fixes this by retrieving relevant passages from your documents at query time and injecting them into context.

**Stack:**
- `nomic-embed-text` via Ollama — embedding model (~270MB, fast on Pi)
- `chromadb` or `sqlite-vec` — vector store on NVMe
- Python indexer script — chunk PDFs → embed → store
- `/api/rag-search` endpoint on relay_server (or separate service)
- `library.js` — call retrieval before sending to Ollama, inject chunks into context

**Source documents to index first:**
1. USCG Navigation Rules / COLREGS
2. Bowditch Vol. 1
3. Pub. 229 Vol. 1
4. Engine manual (when available)

**Implementation note:** Keep chunk size ~400 tokens, overlap ~50. Retrieve top-3 chunks per query. Prepend as `=== REFERENCE ===` block before the VESSEL STATE block.

---

### Helm Chart Tab
The Helm page Chart tab still shows a placeholder. Decision already made (March 2026): implement a Leaflet map in `helm.js` using the same local WMS + ESRI underlay as `sbs-chart.js`.

**Critical:** Do NOT import `sbs-chart.js` directly — it writes to the same DOM ids (`#chart-sog`, `#chart-cog`, etc.) that `helm.js` uses with different formatting. Build a lightweight `HelmChart` init in `helm.js` instead.

**Steps:**
1. Add Leaflet vendor scripts to `helm.html`
2. Add `HelmChart` init in `helm.js` — fires on first Chart tab open, `invalidateSize()` on tab show
3. Add boat position marker (live from `SBSData.position`)
4. Add planned passage polyline from `SBSData.passage`
5. Add AIS targets (reuse pattern from `sbs-chart.js`)

---

### Anchor Watch Mode
- Set anchor position (button tap or auto-detect when SOG < 0.2 kt)
- Configurable drag radius (50m / 100m / custom)
- Alert via `alert-banner` when boat exits radius
- Show anchor marker + radius circle on chart
- Distance and bearing from anchor shown in instruments

---

## 🟡 Medium Priority

### Watch Firmware — Display Driver (`watch/src/main.cpp`)
The scaffold is complete. Remaining work before the watch is functional:
1. **Display driver:** implement `initDisplay()` for the RM67162 AMOLED via QSPI — reference the Waveshare ESP32-S3-Touch-AMOLED-2.06 Arduino demo repo
2. **Touch driver:** register `CST816S` input driver with LVGL (I2C, GPIO6/7 SDA/SCL, INT=GPIO9, RST=GPIO8 — verify against schematic)
3. **Autopilot commands:** implement ±1°/±10° heading adjust POSTs to SignalK or relay_server (need to confirm SignalK autopilot PUT path for heading adjust)
4. **UI polish:** update tile values live from `boat` struct on each LVGL refresh cycle; confirm tileview swipe between modes works on touch hardware
5. **Secrets:** run `python3 scripts/gen_watch_secrets.py` on any new machine before building

### Manual NGA Publication Downloads
These can't be automated — msi.nga.mil blocks scraping for these titles. Download manually and scp to `/var/www/html/docs/pacific/`:
- Pub 105 — Pilot Chart of the North Pacific Ocean
- Pub 106 — Pilot Chart of the South Pacific Ocean
- Pub 122 — Sailing Directions Enroute: North Pacific Ocean (West)
- Pub 123 — Sailing Directions Enroute: North Pacific Ocean (East)
- Pub 124 — Sailing Directions Enroute: South Pacific Ocean (West)
- Pub 125 — Sailing Directions Enroute: South Pacific Ocean (East)

After downloading, re-run RAG indexer:
```bash
ssh pi@100.109.248.77 "nohup python3 ~/index_docs.py > ~/index_docs.log 2>&1 &"
```

### Starlink Status Card
`relay_server.py` already has `/starlink` endpoint. Wire it into the Systems page:
- Signal quality, obstruction %, download/upload speed
- Show on a card in the Systems (formerly Controls) tab

### Weather-Based Departure Windows
Departure Windows in Plan currently shows tide windows only. Integrate Open-Meteo forecast:
- For each candidate departure slot, fetch wind at departure point
- Highlight favorable (beam/downwind) vs unfavorable (hard beat, gale) windows
- Show weather icon + wind speed/direction per slot

### AIS CPA / TCPA Alerts
- Calculate Closest Point of Approach and Time to CPA for each AIS target
- Alert via `alert-banner` when CPA < configurable threshold (default 0.5 nm)
- Show CPA/TCPA in AIS target popup on chart

### MOB Position Persistence
MOB position is currently in-memory only — lost on page refresh. Persist to `localStorage`. On load, restore active MOB state and continue the clock.

### Route Library (Save/Load Passages)
- Save named routes to `localStorage`
- Load route UI in Plan > Overview
- Useful for common passages (e.g. "Sausalito → Drakes Bay")

### WMS Tile Coverage Expansion
- Run `warm.html` in desktop Chrome to warm cache for intended cruising area
- Verify NOAA ENC coverage extends to planned destinations
- Note: NOAA ENCs don't cover Canadian waters — research DFO chart sources for BC passages

---

## 🟢 Lower Priority / Nice to Have

### Weather Routing for Passage Planning
Full polar-diagram-based routing against GRIB forecast. Blocked on: obtaining SV-Esperanza polar data (requires measurement or research), GRIB file management, routing algorithm. Consider `pypolarroute` or OpenCPN plugin API.

### Logbook
Auto-log position/speed/course every N minutes during passage. Manual entries. Export CSV/KML. Show track on chart.

### Watch Schedule Enhancements
- Show active watch crew member in Helm topbar
- Watch duty checklist (log entries, weather obs, position fixes)
- Off-watch crew notifications

### Fuel Calculator
- Fuel burn rate per RPM (manual input)
- Consumption estimate for active passage
- 1/3 rule reserve calculation

### Remote SignalK Access via Tailscale
Configure SignalK to bind to `0.0.0.0` so it's accessible on Tailscale IP (currently only localhost). Check firewall. Would allow remote instrument monitoring.

### NMEA 2000 Integration
USB-to-N2K adapter (Actisense NGT-1 or Yacht Devices YDNU-02) + SignalK canboat-js plugin. Provides faster updates and richer data than NMEA 0183.

### Dark Mode Testing Pass
Night mode has not been tested thoroughly across all sub-panels. Do a systematic pass — especially new Library page, Helm weather strip, AI chat panel.

---

## ✅ Recently Completed

- **GPIO pin reorganization** — CH1→GPIO22, CH3→GPIO23; SW4/SW5→ESP32 GPIO32/33; GPIO14/15 permanently free for MAIANA AIS UART0
- **ESP32 SW4/SW5 HTTP switches** — physical switches on ESP32 toggle cabin lights and vent fan via HTTP POST; flashed OTA
- **BH1750FVI light sensor** — added to ESP32 I2C bus; reports lux to SignalK and Home Assistant; flashed OTA
- **Watch firmware scaffold** — `watch/` directory with WiFiMulti, SignalK WS, relay API, 3-mode LVGL UI; PlatformIO build config
- **Shared secrets** — `scripts/gen_watch_secrets.py` generates `watch/src/secrets.h` from `esphome/secrets.yaml`
- **Pacific sailing library** — download script written; Pub 120, Chapman's, Bowditch downloaded; RAG indexer re-run
- **Remote OTA ESP32 flash** — ESPHome installed on Pi; confirmed working via Tailscale; documented in CLAUDE.md Lesson #2
- **Library page** — 4th nav tab with AI assistant, Kiwix collections, PDF references, audio browser
- **Offline AI assistant** — Ollama + phi4-mini, streaming chat, live boat context injection
- **Kiwix offline library** — 29 ZIM files, collection cards with direct links, ↺ REINDEX button
- **Autoindex styling** — Dark-themed `/docs/` directory listings
- **Instruments grid** — Full-width fill with 2/3/4/5-column breakpoints
- **Helm weather strip** — Real Open-Meteo data (wind + ocean currents + waves)
- **Helm passage** — Passage plan from Nav Station now appears on Helm page
- **All temperatures → °F** — Instruments, helm, diagnostics
- **Plan map zoom fix** — No longer zooms out on every waypoint add
- **Waypoint hazard markers** — Red markers when WMS detects WRECKS/UWTROC/OBSTRN nearby
- **Night mode button** — Compact size in topbar
- **SD card content recovery** — 15 PDFs + 29 ZIM files restored to NVMe
- **Controls → Systems rename**

---

## Known Bugs

| Bug | Severity | Notes |
|-----|----------|-------|
| SignalK charts endpoint 404 | Low | `/signalk/v1/api/resources/charts` returns 404. Falls back gracefully to local WMS. |
| Manual override switches untested | Medium | Physical GPIO inputs not tested since NVMe migration. Verify on-boat. |
| Mobile Safari layout edge cases | Low | Tested primarily Chrome/iPad Safari. iPhone URL-bar viewport height may cause issues. |
| Helm Chart tab placeholder | High | Still shows "OpenCPN pending" — see roadmap above. |
