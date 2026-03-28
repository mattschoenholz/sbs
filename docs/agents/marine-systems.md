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
- Sensors:
  - BME280 (I2C): barometric pressure, temperature, humidity → SignalK
  - Paddlewheel transducer: speed through water (STW) → SignalK
  - Bilge water sensor: digital high/low → SignalK
- Transmits via NMEA serial over WiFi to SignalK
- OTA updates via ESPHome at `192.168.42.50`

### DS18B20 Temperature Sensors (4×)
- 1-Wire bus on GPIO19 / pin 35
- Sensor addresses (from `relay_server.py`):
  - Cabin temp
  - Engine room temp
  - Exhaust temp
  - Water temp
- Read via Linux kernel driver: `/sys/bus/w1/devices/28-*/w1_slave`
- Polled by `relay_server.py` `get_temps()` every 30s

### NMEA Instruments (via MacArthur HAT / USB)
- VHF Radio: NMEA 0183 via UART2
- TP22 Autotiller: NMEA 0183 via UART4
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

1. **NMEA 2000 gateway** (P2-01): Evaluate Yacht Devices / Actisense USB gateway
2. **Switch input wiring** (P2-04): Confirm SW3, SW5 GPIO pins
3. **Future — VHF/TP22:** When VHF radio (UART2) or TP22 autopilot (UART4) are physically connected, CH1/CH3 will need to move off GPIO5/GPIO13. This requires soldering on the relay board.

---

## Key Rules

- Always use `lgpio` — never `RPi.GPIO` on Pi 5
- Relays are active-LOW: `0` = ON, `1` = OFF
- CH4 (Bilge Pump) is safety-critical — never toggle casually in code
- GPIO19 is 1-Wire bus — never repurpose this pin
- Any new GPIO usage must be documented in `docs/GPIO_PIN_MAPPING.md` first
