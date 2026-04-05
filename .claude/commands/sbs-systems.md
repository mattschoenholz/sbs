---
name: sbs-systems
description: Load full SailboatServer system expertise — hardware inventory, software stack, critical wiring rules, service topology, and current project status for SV-Esperanza. Use at the start of any session involving boat hardware, sensors, NMEA, SignalK, or ESPHome.
---

# SailboatServer — System Expertise Load

You are working on **SV-Esperanza** — a 1984 Catalina 27 Mk II with a Raspberry Pi 5 boat computer. Read and internalize everything below before proceeding.

---

## System Topology

```
Mac (dev) ──deploy.sh──→ Pi 5 (192.168.42.201 / 100.109.248.77 Tailscale)
                              │
                    ┌─────────┴──────────┐
                    │  nginx :80         │  Static web portal + WMS tile proxy
                    │  relay.service     │  Flask GPIO API :5000
                    │  tp22-nmea.service │  TP22 autopilot NMEA bridge :5002
                    │  signalk :3000     │  NMEA instrument hub
                    │  ollama :11434     │  Offline LLM (phi4-mini)
                    │  kiwix :8080       │  Offline library (ZIM files)
                    └────────┬───────────┘
                             │  WiFi 192.168.42.x
                    ESP32 (192.168.42.50)
                    ESPHome firmware — sensors → NMEA → SignalK TCP :10110
```

---

## Hardware on Pi

| Component | Detail |
|-----------|--------|
| Board | Raspberry Pi 5 (8GB), NVMe SSD boot |
| HAT | MacArthur HAT v1.2 |
| UART2 | GPIO4 TX / GPIO20 RX → VHF Radio (not yet wired) |
| UART4 | GPIO12 TX → TP22 autotiller NMEA IN (wired, working) |
| GPIO lib | **`lgpio`** only — `RPi.GPIO` is incompatible with Pi 5 |
| Relay board | Waveshare 8-ch, **active-LOW** (0 = ON, 1 = OFF) |

**Relay assignments:**

| CH | GPIO | Function | Safety |
|----|------|----------|--------|
| CH1 | 5 | Cabin Lights | Shares UART2 RX — OK until VHF wired |
| CH2 | 6 | Nav Lights | — |
| CH3 | 13 | Anchor Light | Shares UART4 RX — OK (TP22 is TX-only) |
| CH4 | 16 | Bilge Pump | **SAFETY CRITICAL** |
| CH5 | 25 | Water Pump | — |
| CH6 | 24 | Vent Fan | — |
| CH7 | 18 | Instruments | — |
| CH8 | 17 | Starlink Power | — |

---

## ESP32 Sensor Node

- Static IP: `192.168.42.50` | MAC: `6c:c8:40:89:f0:60` (replaced 2026-04-05)
- Firmware: `esphome/sv_esperanza_sensors.yaml` | Flashed via: `python3 -m esphome`
- I2C bus: SDA=GPIO21, SCL=GPIO22

| Sensor | Address | Provides |
|--------|---------|----------|
| BME680 (BSEC2) | I2C 0x77 | Pressure, temp, humidity, IAQ, CO₂, VOC |
| AHT20 | I2C 0x38 | Air temp + humidity (primary; may be damaged) |
| INA226 | I2C 0x40 | House battery V/A/W via 100A/75mV shunt |
| BH1750FVI | I2C 0x23 | Ambient light (lux) |
| DS18B20 ×2 | 1-Wire GPIO25 | Engine coolant + exhaust temps |
| Paddlewheel | GPIO4 pulse | Speed through water |
| Bilge sensor | GPIO26 | Float switch |
| Engine RPM | GPIO18 pulse | Alternator W terminal optocoupler |
| Fuel sender | GPIO39 ADC | Resistive float (33–240Ω) |
| Starter battery | GPIO35 ADC | Voltage divider |
| Shore power | GPIO34 ADC | ZMPT101B AC voltmeter |

---

## Service API Reference

**relay_server.py (port 5000):**
- `GET /relays` — all relay states
- `POST /relay/<n>` — `{"state": 0|1}`
- `GET /temps` — DS18B20 readings
- `POST /autopilot/heading/engage` → proxies to tp22_nmea.py
- `POST /autopilot/heading/adjust` → `{"delta": ±1|±10}`
- `POST /autopilot/heading/disengage`
- `GET /autopilot/heading/state`

**tp22_nmea.py (port 5002, localhost only):**
- `POST /engage`, `POST /adjust`, `POST /disengage`, `GET /state`
- Sends APB + RMB to TP22 at 1 Hz; route mode (SK waypoint) > manual > silence

---

## Critical Rules — Read Before Touching Anything

### TP22 Autotiller
- Wire orientation on UART4 is **correct as-is — do not swap**
- **Both APB + RMB required at 1 Hz** — APB alone drops immediately
- `$` prefix in NMEA sentences is eaten by double-quoted SSH strings — use Python or heredoc
- Button sequence: Auto on tiller → Engaged in portal → Nav on tiller
- See `docs/LESSONS_LEARNED.md` §21

### INA226 Battery Monitor
- **NEVER connect V+ and V- directly to battery rails** — 12V across the 0.1Ω onboard shunt = ~1440W → instant destruction (destroyed previous ESP32, BMP280, INA226)
- VIN+ → battery-side shunt terminal, VIN- → load-side shunt terminal (only millivolts differential)
- Config: `shunt_resistance = 0.00075Ω`, `max_current = 100A`
- See `docs/LESSONS_LEARNED.md` §22

### ESPHome / ESP32
- **Never USB-flash unless OTA is broken.** Always use OTA via Pi.
- ESPHome is NOT in Pi PATH: always `python3 -m esphome`, never `esphome`
- Always add `--no-logs` for remote SSH flash (otherwise hangs waiting for serial)
- ESPHome version on Pi: **2026.2.4** — uses `request_headers`, not `headers`
- Use `/flash-esp32` skill for the correct command

### WMS Tile Cache
- Cache key includes Leaflet's floating-point bbox — ARM64 (Pi) and x86 (Mac Chrome) differ
- Always warm `web/warm.html` in **desktop Chrome on Mac** — never from the Pi side
- See `CLAUDE.md` §1

### GPIO
- Pi 5 uses `lgpio` — `RPi.GPIO` will fail silently or error
- CH4 (Bilge Pump) is safety-critical — never toggle casually
- GPIO19 is 1-Wire bus — never repurpose

---

## Current Status (as of 2026-04-05)

| System | Status |
|--------|--------|
| TP22 autotiller | ✅ Dock-tested; underway test pending |
| BME680 BSEC2 | 🔧 Firmware flashed; physical install in progress |
| INA226 + 100A shunt | 🔧 Config updated; wiring in progress |
| AHT20 | ❓ May have been destroyed in 12V incident |
| All relay channels | ✅ Working |
| Helm autopilot UI | ✅ Wired to real API |
| Ollama / Kiwix | ✅ Running |
| MAIANA AIS | 📋 Planned (UART0 reserved) |
| VHF radio | 📋 Not yet wired |

---

## Key File Map

| What | Where |
|------|-------|
| All hard rules | `CLAUDE.md` (read first) |
| Full topology + SSH creds | `docs/AGENT_HANDOFF.md` |
| Hard-won lessons | `docs/LESSONS_LEARNED.md` |
| Roadmap | `docs/PENDING_WORK.md` |
| Agent domain docs | `docs/agents/` |
| ESP32 firmware | `esphome/sv_esperanza_sensors.yaml` |
| GPIO pin map | `docs/GPIO_PIN_MAPPING.md` |
| Pi Flask API | `server/relay_server.py` |
| TP22 daemon | `server/tp22_nmea.py` |
| Deploy script | `scripts/deploy.sh` |
| Helm UI | `web/helm.html` + `web/js/helm.js` |
| Portal UI | `web/index.html` + `web/js/portal.js` |

---

## Deploy Quick Reference

```bash
# Local (on boat WiFi)
bash scripts/deploy.sh

# Remote via Tailscale
PI_HOST=100.109.248.77 bash scripts/deploy.sh

# OTA ESP32 flash via Pi
ssh pi@100.109.248.77 "cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs"
```

You are now oriented. Proceed with the user's request.
