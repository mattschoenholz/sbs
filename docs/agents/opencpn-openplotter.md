# Agent: OpenCPN & OpenPlotter

**Project:** SailboatServer — SV-Esperanza
**Domain:** OpenCPN integration, OpenPlotter stack, NMEA 2000, route exchange

---

## Role

Own the integration between the SailboatServer web portal and the OpenCPN/OpenPlotter ecosystem on the Pi. Design and implement route exchange, deep linking, NMEA 2000 readiness, and any OpenPlotter-specific configuration.

---

## Current State

### OpenCPN on Pi
- **Installed:** Yes (`/usr/bin/opencpn`)
- **Chart directory:** `/data/charts/noaa_enc/` (S-57 files, shared with MapServer)
- **Status:** Functional as standalone chart plotter; not yet integrated with web portal
- **Polar data:** Not loaded (needed for weather routing)
- **Weather routing plugin:** Not configured

### OpenPlotter on Pi
- Pi runs OpenPlotter-style stack: SignalK + OpenCPN + supporting tools
- SignalK is the central NMEA hub (port 3000)
- OpenCPN can read same SignalK data via SignalK OpenCPN plugin

### What Works Today (No Code Changes Needed)
- OpenCPN reads `/data/charts/noaa_enc/` S-57 files natively
- MapServer also reads same files (via GeoPackage merge) — both coexist
- SignalK receives NMEA 0183 from all instruments — OpenCPN can connect as SK client

---

## NMEA 0183 vs NMEA 2000

### Current: NMEA 0183
- All instruments connect via serial (USB or UART)
- MacArthur HAT provides 2× UART terminals (UART2 for VHF, UART4 for TP22)
- SignalK ingests NMEA 0183 sentences (RMC, GLL, DPT, MWV, VHW, etc.)
- Works today, no hardware changes needed

### Future: NMEA 2000 (P2-01)
- NMEA 2000 is the modern standard (CAN bus, plug-and-play)
- Many newer instruments are NMEA 2000 only
- **Recommended gateway options:**
  - Yacht Devices YDNU-02 (USB NMEA 2000 gateway) — well-supported by SignalK
  - Actisense NGT-1 (USB) — mature, widely used
  - Both work with SignalK `canboat` / `signalk-n2k-*` plugins
- No code changes to SBS portal needed — SignalK normalizes NMEA 2000 to same paths

### SignalK as NMEA Bus
SignalK is the right integration point:
- Ingests: NMEA 0183 (serial), NMEA 2000 (via USB gateway), TCP/UDP NMEA streams
- Exposes: REST API, WebSocket, plugins
- SBS portal already consumes SignalK exclusively — NMEA version is transparent to web UI

---

## Planned Integration: Portal ↔ OpenCPN (P3-01)

### Route Exchange
**Goal:** Sync passage plans between the SBS portal and OpenCPN.

**Approach A — GPX Export/Import:**
- Portal exports waypoints as GPX file (download link)
- User manually imports into OpenCPN
- Simple, no code on Pi needed
- Downside: manual sync

**Approach B — SignalK Resources Plugin:**
- SignalK `resources` plugin stores routes as GeoJSON at `/signalk/v1/api/resources/routes/`
- Portal writes routes via SignalK REST API
- OpenCPN reads routes via SignalK OpenCPN plugin
- Best long-term approach — single source of truth

**Approach C — OpenCPN HTTP API (future OpenCPN 6):**
- OpenCPN 6 is adding REST API — not yet stable
- Monitor: `opencpn.org/OpenCPN/news.html`

**Recommended:** Start with Approach A (GPX export button in portal), plan for B.

### Deep Link to OpenCPN (P2-02)
When user clicks "Open in OpenCPN" in Helm Chart tab:
- Attempt to raise OpenCPN window via D-Bus or `wmctrl`
- Fallback: display instruction to open OpenCPN manually
- Only works if Pi has a display connected (not relevant for headless deployment)

---

## OpenCPN Configuration on Pi

```bash
# Config directory
~/.opencpn/

# Launch (if display connected)
opencpn &

# Chart data directory (already set up)
/data/charts/noaa_enc/

# Add chart dir in OpenCPN:
# Options → Charts → Chart Files → Add Directory → /data/charts/noaa_enc/
```

### Plugins to Evaluate
| Plugin | Purpose |
|--------|---------|
| SignalK Connector | Receive instrument data from SignalK |
| Weather Routing | Polar-based routing (needs polar diagram) |
| Dashboard | Instrument display overlay |
| AIS Radar | AIS targets on chart |

### Polar Diagram (SV-Esperanza — Catalina 27 MK2)
- No polar loaded yet
- Source: `jimsail.com` polars, or measure from on-the-water data
- Required for weather routing plugin
- File format: `.pol` (OpenCPN) or CSV
- Store at `~/.opencpn/polars/catalina27.pol`

---

## Key Rules

- OpenCPN and MapServer/nginx can coexist — both read `/data/charts/noaa_enc/`
- Don't modify S-57 files in `/data/charts/noaa_enc/` — read-only for both apps
- SignalK is the NMEA integration point — don't connect instruments directly to OpenCPN if SignalK can handle it
- NMEA 2000 gateway choice must not conflict with existing GPIO/UART usage — see `docs/GPIO_PIN_MAPPING.md`
- Start simple (GPX export) before building complex SignalK route sync
