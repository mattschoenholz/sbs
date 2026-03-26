# SailboatServer — Pending Work & Roadmap

Status as of March 2026. Items are ordered roughly by priority.

---

## 🔴 High Priority

### UX Architecture Redesign — Navigation Overhaul
**Problem:** Three levels of navigation (tabs → subtabs → within-panel controls) makes the app difficult to use, especially on a phone in a moving boat.

**Decision pending:** Three options were presented to the user:

**Option A — Three Scenes (Before Sail · Underway · At Anchor)**
- Replace all tabs with three contextual "scenes"
- Before Sail: Plan + weather + pre-departure checklist
- Underway: Chart + instruments + passage + MOB
- At Anchor: Systems + environment + anchor watch
- Pros: Perfectly contextual, no hunting
- Cons: Requires major restructure, context switching if needs change

**Option B — Persistent Controls Dock + 3 Clean Pages** *(Recommended)*
- Bottom dock always visible: relay quick-toggles + critical instruments (SOG/DEPTH/WIND)
- 3 main pages: Chart (map + AIS) | Plan (waypoints, weather, tides) | Status (systems, temps, detailed instruments)
- Helm stays as full-screen overlay (separate page, same approach as today)
- Pros: Minimal restructure, dock solves the "three levels" problem, scales to mobile well
- Cons: Bottom dock competes with Leaflet map controls

**Option C — Cockpit / Cabin Mode Toggle**
- Single toggle in status bar switches between two distinct layouts
- Cockpit mode: Chart + instruments focused, minimal controls
- Cabin mode: Full controls, planning, systems
- Pros: Simple mental model
- Cons: Still two separate contexts, doesn't fully solve nav depth problem

**Implementation work:**
- Likely involves restructuring `index.html` layout
- May need a new `dock.js` for persistent instrument strip
- `portal.js` tab logic would need updating

---

### Helm Chart Tab
**Status:** Helm **Chart** panel still shows the placeholder (“OpenCPN integration pending”). Portal **Manage → Charts** already has a full Leaflet + local WMS map (`sbs-chart.js`).

**Decision (March 2026):** Implement **Option A — Leaflet chart in Helm** (local WMS + ESRI underlay, boat marker, AIS, passage polyline), aligned with the warmed nginx tile cache. **Do not** simply load `sbs-chart.js` on `helm.html` without addressing DOM id clashes (see below).

**Rejected / deferred for now:**
- **OpenCPN via VNC/iframe** — optional later; native OpenCPN on the Pi can use `/data/charts/noaa_enc/` independently of the web UI.
- **Boat-only placeholder map** — unnecessary given WMS is already the standard stack.

**Implementation notes (read `CLAUDE.md` § Helm Chart tab):**
- `helm.js` updates overlay pills as `#chart-sog`, `#chart-cog`, `#chart-depth`, `#chart-tws`, `#chart-twd`, `#chart-pos` with **labeled** strings (e.g. `SOG 5.2 kn`).
- `sbs-chart.js` `updateOverlays()` writes the **same element ids** with **different** formatting (mostly raw numbers). Importing `sbs-chart.js` as-is will **fight** `helm.js`.
- **Preferred:** dedicated thin init in `helm.js` (e.g. `HelmChart`) + Leaflet vendor scripts on `helm.html`, init on **first** Chart tab activation, then `map.invalidateSize()` when the tab is shown.
- **Alternative:** refactor `sbs-chart.js` to accept configurable element id prefix or optional overlay updates.

---

### WMS Tile Coverage Gap
**Status:** Some tile areas still missing, especially at higher zoom levels or new cruising regions.

**Warming:** Use **`warm.html` in a desktop browser** (not Python/Node on the Pi — see `CLAUDE.md` / `docs/ARCHITECTURE.md` on bbox floating-point). The nginx cache directory on NVMe usually **survives reboots**; re-warm when you expand coverage, clear the cache, or change layer/bbox behavior — not necessarily after every restart.

**Improvement needed:** Auto-warm tiles around the boat's current position and the planned passage route whenever the passage plan changes.

---

## 🟡 Medium Priority

### Weather Routing for Passage Planning
**Requested by user.** Currently passage planning uses a fixed planned SOG. Real weather routing would:
1. Download GRIB files for forecast period
2. Use polar diagram (boat performance data) to calculate VMG at each wind angle/speed
3. Compute optimal route with weather avoidance
4. Show routing result overlaid on chart

**Dependencies needed:**
- Polar data for SV-Esperanza (user does not have this yet — needs measurement/research)
- Weather routing algorithm (consider porting from OpenCPN plugin logic)
- GRIB file storage and management on Pi
- Consider integrating `pypolarroute` or similar Python library

**OpenCPN weather routing plugin** is an option but requires headless OpenCPN execution or exposing its API.

---

### Anchor Watch Mode
**Not yet implemented.** Key features:
- Set anchor position (button or auto-detect when SOG < 0.2 kn)
- Configurable drag radius (e.g., 50m, 100m)
- Alert when boat exits radius
- Display anchor circle on chart
- Show distance and bearing from anchor

**Implementation:**
- `sbs-data.js`: add anchor position and drag detection
- `sbs-chart.js`: add anchor marker and radius circle
- `alert-banner`: trigger anchor drag alert
- Helm display: show anchor watch status when active

---

### Departures Windows — Real Weather Integration
**Current state:** Departure windows in Plan > Windows are based on calculated tide windows only.

**Needed:** Integrate Open-Meteo forecast into departure windows:
- For each potential departure time slot, fetch wind speed and direction at departure point
- Highlight slots with favorable winds (downwind/beam reach) vs. unfavorable (beat into strong wind)
- Show confidence rating based on forecast uncertainty

---

### Offline Chart Coverage Expansion
**Current state:** `enc_merged.gpkg` covers the NOAA ENC charts that were downloaded (~22MB). The warm.html cache covers approximately the local area.

**Needed:** 
- Verify coverage extends 500nm from home port (Seattle) — run warm.html for full PNW coverage including BC waters
- NOAA ENCs don't cover Canadian waters — need Canadian DFO charts or S-57 charts from another source
- Consider downloading BSB/RNC raster charts as fallback

---

### Fuel Calculator
**Status:** Plan > Fuel subtab exists but is minimal/stub.

**Needed:**
- Fuel burn rate per engine RPM (manual input or from engine instruments)
- Distance to destination from current passage plan
- Estimated fuel consumption for passage
- Reserve calculation (USCG recommends 1/3 out, 1/3 back, 1/3 reserve rule)
- Fuel dock lookup (integration with marine fuel dock APIs?)

---

### Watch Schedule Enhancement
**Current state:** Watch schedule in Plan > Watches generates a basic rotation.

**Improvements requested:**
- Integration with passage ETA (show which crew member is on watch at each waypoint)
- Watch duty checklist (log entries, weather observations, position fixes)
- Off-watch notifications

---

## 🟢 Lower Priority / Nice to Have

### Remote SignalK Access
**Current state:** SignalK on Pi is accessible on local network at port 3000. Not exposed via Tailscale.

**To do:** Expose SignalK admin UI on Tailscale IP. May need to configure SignalK to bind to `0.0.0.0` instead of `localhost`. Verify firewall rules.

### NMEA 2000 Integration
**Current state:** All data comes via NMEA 0183 serial. N2K would provide more data and faster updates.

**Needed:** USB-to-NMEA 2000 adapter (e.g., Actisense NGT-1 or Yacht Devices YDNU-02) + SignalK canboat-js plugin.

### AIS Target Details
**Current state:** AIS targets shown on map as icons with basic info on click.

**Improvements:**
- CPA (closest point of approach) calculation and warning
- TCPA (time to CPA) display
- Alert if CPA < configured threshold
- Show vessel names on map at certain zoom levels
- Filter AIS by type (cargo, sailing, fishing, etc.)

### Logbook
**Not yet started.**
- Auto-log position, speed, course every N minutes during passage
- Manual log entry support
- Export to CSV/KML
- Show track on chart

### MOB Position Storage
**Original priority list item.** Currently MOB position is stored in memory (lost on page refresh).

**Fix:** Persist MOB position and activation time to `localStorage`. On page load, check if active MOB was set and restore the state (continue counting time, show marker).

### Passagemaker Route Library
**Not yet started.** Save/load named routes. Useful for common passages (e.g., "Seattle to Victoria", "Friday Harbor Loop"). Currently each session starts fresh and must re-enter waypoints.

**Implementation:** Store routes in `localStorage` as named route objects. Add "Save Route As" and "Load Route" UI elements to Plan > Overview.

### Dark Mode / Night Mode Improvements
**Current state:** Night mode (`body.night-mode`) toggles to amber-only palette. Works via `<night-toggle>` component.

**Reported issue:** Not tested thoroughly on all sub-panels. Some elements may not properly inherit night mode colors.

### Starlink Status Integration
**Current state:** `relay_server.py` has Starlink API endpoint constants (`starlink_endpoints.py`). Actual status polling not integrated into portal UI.

**To do:** Add Starlink status card to Controls Drawer showing signal quality, obstruction %, download speed.

---

## Known Bugs / Issues

### SignalK Charts Endpoint 404
`/signalk/v1/api/resources/charts` returns 404. The SignalK charts plugin may need reconfiguration. Currently handled gracefully in `sbs-chart.js` (falls through to local WMS). Not causing user-visible issues.

### WMS Performance — First Render
MapServer is slow on cache miss (200-500ms per tile). Fast on cache hit (<5ms via nginx cache). Solution is warming the cache via `warm.html` before use. No fix needed unless real-time rendering for new areas becomes critical (could add streaming tile download).

### relay_server.py Manual Override Switches
The physical manual override switch integration in `relay_server.py` has not been tested since the NVMe migration. Verify GPIO input pins still read correctly after Pi 5 / lgpio migration.

### Mobile Safari Layout
The app has been primarily tested in Chrome on Mac and iPad Safari. Some layout edge cases may exist on iPhone Safari, particularly with `100dvh` behavior in Safari's variable viewport height handling (URL bar appearing/disappearing).

---

## Deferred from Original Priority List

These were identified early in the project but not yet implemented:
- **Center-on-boat button** — ✅ DONE
- **Open-Meteo weather** — ✅ DONE
- **NOAA Tides** — ✅ DONE
- **AIS into single WebSocket** — ✅ DONE
- **Relay naming consistency** — ✅ DONE
- **Auto cache-busting** — ✅ DONE
- **MOB position storage** — ⏳ Partial (in-memory only, not persisted)
