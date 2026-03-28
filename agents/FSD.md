# SailboatServer — Feature Specification Document

**Vessel:** SV-Esperanza · **Owner:** Matt Schoenholz
**Last Updated:** March 2026

This document tracks planned features, active work, and known issues. Organized by priority tier and agent ownership.

---

## Priority 1 — Active / Immediate

### P1-01: Helm Chart Tab — Leaflet Map
**Owner:** Chart & Navigation + Frontend
**Status:** Pending
**Spec:**
- Implement the Chart tab in `helm.html` as a Leaflet map
- Same data sources as portal: LOCAL WMS + ESRI underlay, boat marker, AIS, passage line
- Do NOT reuse `sbs-chart.js` directly — DOM ID conflicts with `helm.js` (see CLAUDE.md §4)
- Implement as `HelmChart` class inside `helm.js`
- Init on first tab open; call `map.invalidateSize()` on tab visibility
- Boat marker tracks `navigation.position` from `SBSData`
- AIS targets rendered as simple circles with MMSI labels

### P1-02: Crew View (New Interface)
**Owner:** UX Designer + Frontend
**Status:** Design phase
**Spec:**
- New file: `crew.html`
- Read-only: instruments + chart + passage status
- No relay controls, no passage editing
- Mobile-first (phone/tablet in cockpit or below)
- Pulls same SignalK data as Helm via `sbs-data.js`
- Night mode toggle

### P1-03: Physical Relay Jumper Moves
**Owner:** Marine Systems (hardware task, no code)
**Status:** Pending physical access
**Spec:**
- CH1: Move jumper from GPIO5 (pin 29) → GPIO20 (pin 38) — clears UART2 RX conflict
- CH3: Move jumper from GPIO13 (pin 33) → GPIO21 (pin 40) — clears UART4 RX conflict
- After move: test relays CH1 and CH3 via portal Controls drawer
- See `docs/GPIO_PIN_MAPPING.md` for full pin conflict history

---

## Priority 2 — Near-Term

### P2-01: NMEA 2000 Readiness
**Owner:** Marine Systems
**Status:** Design
**Spec:**
- Evaluate Yacht Devices or Actisense USB NMEA 2000 gateway
- SignalK already supports NMEA 2000 via canboat/`signalk-n2k-*` plugins
- No code changes needed until gateway hardware is selected
- Document chosen gateway in `docs/GPIO_PIN_MAPPING.md`

### P2-02: OpenCPN Deep Link from Helm Chart
**Owner:** OpenCPN & OpenPlotter + Chart & Navigation
**Status:** Design
**Spec:**
- Helm Chart tab button: "Open in OpenCPN"
- Uses OpenCPN's `opencpn://` URI scheme or X11/Wayland window raise
- Requires OpenCPN running on Pi with NOAA ENCs loaded
- Fallback: display message if OpenCPN not running

### P2-03: Role-Based Access (Captain vs Crew)
**Owner:** Frontend + Backend & Pi
**Status:** Design
**Spec:**
- Captain mode: PIN-gated (stored in `localStorage`, hashed)
- Captain unlocks: relay controls, passage editing, system controls
- Crew mode: default — instruments, chart, passage status (read-only)
- PIN entry via Controls drawer or dedicated button
- No server-side auth required (local boat network, trusted)

### P2-04: Manual Override Switch Inputs
**Owner:** Marine Systems + Backend & Pi
**Status:** Partially planned
**Spec:**
- Physical switches on relay board wired to GPIO input pins
- SW1→GPIO6, SW4→GPIO26 (confirmed in code)
- Read switch state in `relay_server.py` and expose via `/switches` endpoint
- Display switch overrides in portal Controls drawer
- See `docs/GPIO_PIN_MAPPING.md` — SW3, SW5 pins still TBD

### P2-05: OpenWeatherMap Key Management
**Owner:** Frontend
**Status:** Pending (key was revoked, new key needed)
**Spec:**
- User enters new OWM key via Chart tab → "Set API Key"
- Stored in `localStorage` key `sbs-owm-key`
- No server-side key storage

---

## Priority 3 — Future

### P3-01: OpenCPN / OpenPlotter Integration
**Owner:** OpenCPN & OpenPlotter
**Status:** Design
**Spec:**
- Bi-directional route sync: portal passage plan → OpenCPN GPX export
- OpenCPN active route → portal passage display
- Shared chart directory: `/data/charts/noaa_enc/`
- Consider SignalK `resources` plugin as route exchange bus

### P3-02: Weather Routing
**Owner:** Chart & Navigation + Data & Instruments
**Status:** Future
**Spec:**
- Requires polar diagram for SV-Esperanza (Catalina 27 MK2)
- OpenCPN weather routing plugin as primary tool
- Portal departure windows already show wind — extend to routing optimization
- GRIB source: NOAA GFS via ERDDAP (already in `sbs-chart.js`)

### P3-03: Boat Starlink Integration
**Owner:** Deploy & Infra + Backend & Pi
**Status:** Future
**Spec:**
- Starlink powered via CH8 relay (GPIO17)
- `starlink_endpoints.py` has Starlink API definitions
- Avoid subnet 192.168.100.x (conflicts with Van Starlink)
- Status card in Controls drawer: signal quality, speed, obstructions
- Power cycle via CH8 relay from portal

### P3-04: Passage Alert Refinements
**Owner:** Data & Instruments + Frontend
**Status:** Backlog
**Spec:**
- Current: wind ≥25kn advisory, ≥34kn urgent, precip ≥60%, thunderstorm codes
- Add: fog (WMO 45-48), current vs planned SOG deviation alert
- Tidal current alerts from NOAA CO-OPS API (tide current stations)
- Alert persistence: dismissable, log to localStorage

### P3-05: Engine Hours / Maintenance Tracking
**Owner:** Backend & Pi
**Status:** Idea
**Spec:**
- Track engine run time via DS18B20 exhaust temp (high temp = engine on)
- Persist hours to Pi filesystem
- Display in Controls drawer
- Alert at maintenance intervals (oil change, etc.)

---

## Known Bugs / Issues

| ID | Description | Owner | Status |
|----|-------------|-------|--------|
| BUG-01 | WMS bbox float mismatch: warm only via `warm.html` in Chrome on x86 | Chart & Navigation | Known workaround |
| BUG-02 | SignalK charts endpoint 404 — fallback to LOCAL WMS already in place | Chart & Navigation | Mitigated |
| BUG-03 | CH1/CH3 share GPIO5/GPIO13 with UART2/UART4 RX — only a conflict when VHF/TP22 physically connected | Marine Systems | Deferred (no action until instruments wired) |
| BUG-04 | Helm Chart tab not implemented | Chart & Navigation | P1-01 |
