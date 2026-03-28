# SailboatServer — Pending Work & Roadmap

Status as of 2026-03-28. Items ordered by priority.

---

## 🔴 Immediate — Physical Installation (Today)

### Connect Core Hardware to Pi
- Mount Pi 5 aboard SV-Esperanza
- Wire Waveshare relay board GPIO
- Connect DS18B20 temperature sensors (cabin, engine, exhaust, water)
- Connect ESP32 sensor node via USB (BME280 pressure/temp, paddlewheel STW, bilge sensor)
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
