# Agent: Marine Systems

**Project:** SailboatServer — SV-Esperanza
**Domain:** NMEA instruments, SignalK, GPIO, sensors, hardware integration

---

## Role

Own the hardware and marine protocol layer: NMEA 0183/2000 instrument integration, SignalK configuration, GPIO relay/sensor code, and physical hardware documentation. Interface between physical boat systems and the software stack.

---

## Hardware Inventory

### Raspberry Pi 5 (8GB)
- NVMe SSD via HAT (boot device)
- GPIO 40-pin header — heavily allocated, see `docs/GPIO_PIN_MAPPING.md`
- `gpiochip4` (Pi 5 — not gpiochip0)
- GPIO library: **`lgpio`** (NOT `RPi.GPIO` — incompatible with Pi 5)

### MacArthur HAT v1.2
- UART2: GPIO4 TX / **GPIO20 RX** (VHF Radio — Standard Horizon SH-2150)
  - Note: originally GPIO5 RX, moved to GPIO20 via jumper fix (cleared CH1 conflict)
- UART4: GPIO12 TX / **GPIO21 RX** (TP22 Autotiller)
  - Note: originally GPIO13 RX, moved to GPIO21 via jumper fix (cleared CH3 conflict)
- 1-Wire: GPIO19 / pin 35 (DS18B20 sensors, 1.6KΩ pull-up)
- See `docs/GPIO_PIN_MAPPING.md` for full pin allocation

### Waveshare Relay Board B (8-channel)
- Active-LOW logic: GPIO LOW = relay ON, GPIO HIGH = relay OFF
- Jumper-configurable GPIO pins
- **Current pin assignments (post-jumper-fix):**

| Channel | GPIO | Pin | Function | Safety |
|---------|------|-----|----------|--------|
| CH1 | 5 | 29 | Cabin Lights | Shares UART2 RX — OK until VHF connected |
| CH2 | 6 | 31 | Navigation Lights | — |
| CH3 | 13 | 33 | Anchor Light | Shares UART4 RX — OK until TP22 connected |
| CH4 | 16 | 36 | Bilge Pump | **SAFETY CRITICAL** |
| CH5 | 25 | 22 | Water Pump | — |
| CH6 | 24 | 18 | Vent Fan | — |
| CH7 | 18 | 12 | Instruments | — |
| CH8 | 17 | 11 | Starlink Power | — |

- CH4 (Bilge Pump): NEVER disable unexpectedly. Always verify relay logic before any GPIO change.

### Manual Override Switches (Relay Board)
- 5 physical switches wired to GPIO inputs
- SW1→GPIO6, SW4→GPIO26 confirmed
- SW3, SW5 pins TBD
- Switches read by `relay_server.py` (planned — see `agents/FSD.md` P2-04)

### ESP32 Sensor Node
- ESPHome firmware: `sv_esperanza_sensors.yaml`
- Static IP: `192.168.42.50`
- MAC: `6c:c8:40:89:f0:60` (replacement board, flashed 2026-04-05)
- Transmits via NMEA serial over WiFi to SignalK TCP port 10110
- OTA updates via ESPHome at `192.168.42.50`

**Sensors:**

| Sensor | Interface | What it provides |
|--------|-----------|-----------------|
| BME680 (I2C 0x77, BSEC2) | I2C | Pressure, temp, humidity, IAQ (0–500), CO₂ equiv, VOC equiv |
| AHT20 (I2C 0x38) | I2C | Air temp + humidity (primary; comment out if damaged) |
| INA226 (I2C 0x40) | I2C | House battery voltage, current, power (100A/75mV shunt) |
| BH1750FVI (I2C 0x23) | I2C | Ambient light (lux) |
| DS18B20 ×2 | 1-Wire GPIO25 | Engine coolant + exhaust bay temps |
| Paddlewheel | GPIO4 (pulse) | Speed through water (STW) |
| Bilge water sensor | GPIO26 | Float switch (digital high/low) |
| Engine RPM | GPIO18 (pulse) | Alternator W terminal via optocoupler |
| Fuel sender | GPIO39 (ADC) | Resistive float (33–240Ω), 100Ω sense resistor |
| Starter battery | GPIO35 (ADC) | Voltage divider (100kΩ+20kΩ) |
| Shore power | GPIO34 (ADC) | ZMPT101B AC voltmeter |

**I2C bus:** GPIO21 (SDA) / GPIO22 (SCL) — shared by all I2C sensors
**OTA flash (Pi as relay):**
```bash
ssh pi@100.109.248.77 "cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs"
```

### DS18B20 Temperature Sensors (4×)
- 1-Wire bus on GPIO19 / pin 35
- Sensor addresses (from `relay_server.py`):
  - Cabin temp
  - Engine room temp
  - Exhaust temp
  - Water temp
- Read via Linux kernel driver: `/sys/bus/w1/devices/28-*/w1_slave`
- Polled by `relay_server.py` `get_temps()` every 30s

### TP22 Autotiller
- Connected to UART4 TX (GPIO12) — **original wire orientation, do not swap**
- Controlled by `server/tp22_nmea.py` (asyncio daemon, `tp22-nmea.service`)
- Receives APB + RMB at 1 Hz; APB alone is not sufficient
- Serial port: `/dev/ttyOP_tp22` → `/dev/ttyAMA4`, 4800 baud
- See `docs/LESSONS_LEARNED.md` §21 for full wiring and nav mode notes

**Note on CH3:** CH3 is on GPIO13 which shares the UART4 RX pin. TP22 is TX-only (Pi sends, TP22 listens) so CH3 and UART4 can safely coexist — no conflict.

### NMEA Instruments (via MacArthur HAT / USB)
- VHF Radio: NMEA 0183 via UART2 (not yet physically connected)
- GPS module: USB serial
- Depth sounder: USB/serial
- Wind instruments: USB/serial

---

## SignalK

- **Port:** 3000
- **WebSocket:** `ws://sailboatserver.local:3000/signalk/v1/stream`
- **Config dir:** `~/.signalk/` on Pi
- **Key paths used:**

```
navigation.speedOverGround          m/s  → SOG
navigation.courseOverGroundTrue     rad  → COG
navigation.headingTrue              rad  → HDG
navigation.speedThroughWater        m/s  → STW
environment.depth.belowTransducer   m    → DEPTH
environment.wind.speedTrue          m/s  → TWS
environment.wind.angleTrue          rad  → TWD (from N)
environment.wind.speedApparent      m/s  → AWS
environment.wind.angleApparent      rad  → AWA (+/- from bow)
environment.outside.pressure        Pa   → barometer
environment.outside.temperature     K    → outside temp
environment.outside.humidity        0-1  → humidity
navigation.position                      → lat/lon
vessels.*                                → AIS targets
```

---

## relay_server.py

- **Location:** `~/relay_server.py` on Pi (deployed by `scripts/deploy.sh`)
- **Port:** 5000
- **Framework:** Flask + flask-cors
- **GPIO lib:** `lgpio` (Pi 5 only)
- **Key endpoints:**
  - `GET /relays` — current state of all 8 relays
  - `POST /relay/<n>` — set relay n (1-8) state
  - `GET /temps` — DS18B20 readings
  - `GET /system` — CPU temp, load, uptime
  - `GET /network` — IP addresses, Tailscale status
  - `POST /reboot` — reboot Pi

---

## ESPHome Config

- **File:** `sv_esperanza_sensors.yaml`
- **Secrets:** `secrets.yaml` (git-ignored — never commit)
- **Flash via USB:** `esphome run sv_esperanza_sensors.yaml --device /dev/ttyUSB0`
- **OTA update:** `esphome run sv_esperanza_sensors.yaml` (over WiFi)
- **Network:** Static IP 192.168.42.50, gateway 192.168.42.1

---

## Pending Hardware Tasks

1. **INA226 wiring** — connect VIN+/VIN- to 100A/75mV marine shunt measurement terminals (today, 2026-04-05). See `docs/LESSONS_LEARNED.md` §22 for correct wiring — wrong wiring destroyed previous INA226.
2. **BME680 install** — wire to I2C bus (GPIO21/22); firmware already flashed. Check AHT20 survived 12V incident (comment out AHT20 block if dead).
3. **TP22 underway test** — dock test confirmed (2026-04-04); underway test with real SOG/heading pending
4. **NMEA 2000 gateway** — evaluate Yacht Devices / Actisense USB gateway for N2K integration
5. **VHF Radio** — UART2 not yet physically connected; CH1 (GPIO5) shares UART2 RX but only conflicts when VHF is wired in

---

## Key Rules

- Always use `lgpio` — never `RPi.GPIO` on Pi 5
- Relays are active-LOW: `0` = ON, `1` = OFF
- CH4 (Bilge Pump) is safety-critical — never toggle casually in code
- GPIO19 is 1-Wire bus — never repurpose this pin
- Any new GPIO usage must be documented in `docs/GPIO_PIN_MAPPING.md` first
