# GPIO Pin Mapping — SV-Esperanza
**Last audited:** 2026-03-26 (live `gpioinfo gpiochip4` verified)
**Hardware stack:** Pi 5 (8GB) · MacArthur HAT v1.2 · GeeekPi P33 NVMe+PoE HAT · GeeekPi UPS Gen 6 · Waveshare Relay Board B (8-channel)

---

## Current GPIO State (verified from live Pi)

All pins confirmed from `sudo gpioinfo gpiochip4` output on 2026-03-26.

### Active Relay Outputs (Waveshare Relay Board B — active LOW)

| BCM | Phys | CH | Load | Jumper history |
|-----|------|----|----|---|
| 5   | 29  | CH1 | Cabin Lights | ⚠ latent conflict — see below |
| 6   | 31  | CH2 | Navigation Lights | clear |
| 13  | 33  | CH3 | Anchor Light | ⚠ latent conflict — see below |
| 16  | 36  | CH4 | Bilge Pump ← SAFETY CRITICAL | clear |
| 25  | 22  | CH5 | Water Pump | rewired 17→25 |
| 24  | 18  | CH6 | Vent Fan | rewired 18→24 |
| 18  | 12  | CH7 | Instruments | rewired 24→18 |
| 17  | 11  | CH8 | Starlink Power | rewired 25→17 |

**Active LOW:** `gpio_write(h, pin, 0)` = ON · `gpio_write(h, pin, 1)` = OFF
**Library:** `lgpio` via `lgpio.gpiochip_open(4)` — Pi 5 uses gpiochip4

### Manual Override Switch Inputs (not yet physically wired)

| BCM | Phys | SW  | Controls | Status |
|-----|------|-----|----------|--------|
| 20  | 38   | SW1 | CH4 Bilge Pump ← SAFETY CRITICAL | pin confirmed free |
| 22  | 15   | SW2 | CH2 Navigation Lights | pin confirmed free |
| 23  | 16   | SW3 | CH3 Anchor Light | pin confirmed free |
| 26  | 37   | SW4 | CH1 Cabin Lights | clear after reboot (see below) |
| 27  | 13   | SW5 | CH6 Vent Fan | pin confirmed free |

Switch wiring: one leg → GPIO pin, other leg → GND. Internal pull-ups enabled. LOW = switch ON.

---

## Latent Conflicts (latent = no conflict until devices are physically wired)

### CH1 (GPIO5) vs MacArthur UART2 RX — VHF Radio in

| | Device A | Device B |
|--|---|---|
| Pin | GPIO5 (pin 29) | GPIO5 (pin 29) |
| Function | Relay CH1 output (Cabin Lights) | MacArthur HAT UART2 RX — receives NMEA from VHF radio |

**Currently safe:** VHF radio TX wire is not connected to Pi. GPIO5 is only used by relay_server.
**Action required BEFORE wiring VHF TX:** Move CH1 jumper on Waveshare board from GPIO5 (pin 29) to **GPIO14 (pin 8)**.
Then update `relay_server.py`: `RELAY_PINS[1] = 14`

### CH3 (GPIO13) vs MacArthur UART4 RX — TP22 Autotiller in

| | Device A | Device B |
|--|---|---|
| Pin | GPIO13 (pin 33) | GPIO13 (pin 33) |
| Function | Relay CH3 output (Anchor Light) | MacArthur HAT UART4 RX — receives data from TP22 autopilot |

**Currently safe:** TP22 autotiller TX wire is not connected to Pi.
**Action required BEFORE wiring TP22 TX:** Move CH3 jumper on Waveshare board from GPIO13 (pin 33) to **GPIO15 (pin 10)**.
Then update `relay_server.py`: `RELAY_PINS[3] = 15`

> Jumper moves require **no soldering** — Waveshare Relay Board B uses 2-pin header jumpers.

---

## Resolved Conflicts

| GPIO | Conflict | Resolution | Date |
|------|----------|-----------|------|
| 17 | CH8 default conflicted with system use | CH8 jumper moved: 25→17 | Mar 2026 |
| 18 | CH7 default conflicted | CH7 jumper moved: 24→18 | Mar 2026 |
| 19 | CH5 default conflicted with MacArthur 1-Wire | CH5 jumper moved: 19→25 | Mar 2026 |
| 20 | CH6 default (Pi 4 era UART conflict) | CH6 jumper moved: 20→24 | Mar 2026 |
| 24 | CH6 freed it; CH7 was there | CH7 jumper moved: 24→18 | Mar 2026 |
| 26 | `gpio-poweroff` overlay claimed GPIO26 as kernel OUTPUT, conflicting with SW4 input | Removed `dtoverlay=gpio-poweroff` from config.txt — GeeekPi UPS Gen 6 uses I2C only, overlay was unnecessary | 2026-03-26 |

---

## Complete 40-Pin Header Map

| Phys | BCM | Function | Assigned To | Status |
|------|-----|----------|-------------|--------|
| 1  | —  | 3.3V | Power | — |
| 2  | —  | 5V | Power | — |
| 3  | 2  | I2C1 SDA | UPS Gen 6 (0x17) · P33 fan · INA226 future (shared bus) | I2C |
| 4  | —  | 5V | Power | — |
| 5  | 3  | I2C1 SCL | shared I2C bus | I2C |
| 6  | —  | GND | Power | — |
| 7  | 4  | UART2 TX | MacArthur HAT → VHF Radio SH-2150 (RX) | ACTIVE |
| 8  | 14 | UART0 TX | **Reserved: CH1 relay fix** (when VHF is wired) | reserved |
| 9  | —  | GND | Power | — |
| 10 | 15 | UART0 RX | **Reserved: CH3 relay fix** (when TP22 is wired) | reserved |
| 11 | 17 | GPIO | Relay CH8 — Starlink Power | Relay OUT |
| 12 | 18 | GPIO | Relay CH7 — Instruments | Relay OUT |
| 13 | 27 | GPIO | SW5 — Vent Fan switch (not yet wired) | Switch IN |
| 14 | —  | GND | Power | — |
| 15 | 22 | GPIO | SW2 — Nav Lights switch (not yet wired) | Switch IN |
| 16 | 23 | GPIO | SW3 — Anchor Light switch (not yet wired) | Switch IN |
| 17 | —  | 3.3V | Power | — |
| 18 | 24 | GPIO | Relay CH6 — Vent Fan | Relay OUT |
| 19 | 10 | SPI0 MOSI | MacArthur HAT N2K (MCP2518FD — no N2K hardware) | Inactive |
| 20 | —  | GND | Power | — |
| 21 | 9  | SPI0 MISO | MacArthur HAT N2K | Inactive |
| 22 | 25 | GPIO | Relay CH5 — Water Pump | Relay OUT |
| 23 | 11 | SPI0 CLK | MacArthur HAT N2K | Inactive |
| 24 | 8  | SPI0 CE0 | MacArthur HAT N2K | Inactive |
| 25 | —  | GND | Power | — |
| 26 | 7  | SPI0 CE1 | MacArthur HAT N2K | Inactive |
| 27 | 0  | ID_SD | HAT EEPROM | **DO NOT USE** |
| 28 | 1  | ID_SC | HAT EEPROM | **DO NOT USE** |
| 29 | 5  | UART2 RX | CH1 relay (now) / MacArthur UART2 RX (when VHF wired) | ⚠ latent conflict |
| 30 | —  | GND | Power | — |
| 31 | 6  | GPIO | Relay CH2 — Navigation Lights | Relay OUT |
| 32 | 12 | UART4 TX | MacArthur HAT → TP22 Autotiller (RX) | ACTIVE |
| 33 | 13 | UART4 RX | CH3 relay (now) / MacArthur UART4 RX (when TP22 wired) | ⚠ latent conflict |
| 34 | —  | GND | Power | — |
| 35 | 19 | 1-Wire | MacArthur HAT — DS18B20 × 4 (1.6kΩ pull-up on HAT) | ACTIVE |
| 36 | 16 | GPIO | Relay CH4 — Bilge Pump ← SAFETY CRITICAL | Relay OUT |
| 37 | 26 | GPIO | SW4 — Cabin Lights switch (not yet wired) | Switch IN |
| 38 | 20 | GPIO | SW1 — Bilge Pump switch (not yet wired) | Switch IN |
| 39 | —  | GND | Power | — |
| 40 | 21 | GPIO | kernel gpio-shutdown (MacArthur HAT button) | **kernel owned — do not use** |

---

## HAT-by-HAT Summary

### MacArthur HAT v1.2

| BCM | Phys | Function | Active |
|-----|------|----------|--------|
| 4  | 7  | UART2 TX → VHF Radio SH-2150 | Yes |
| 5  | 29 | UART2 RX ← VHF Radio SH-2150 | When VHF wired |
| 7  | 26 | SPI0 CE1 — N2K CAN | No N2K hardware |
| 8  | 24 | SPI0 CE0 — N2K CAN | No N2K hardware |
| 9  | 21 | SPI0 MISO — N2K CAN | No N2K hardware |
| 10 | 19 | SPI0 MOSI — N2K CAN | No N2K hardware |
| 11 | 23 | SPI0 CLK — N2K CAN | No N2K hardware |
| 12 | 32 | UART4 TX → TP22 Autotiller | Yes |
| 13 | 33 | UART4 RX ← TP22 Autotiller | When TP22 wired |
| 19 | 35 | 1-Wire bus (DS18B20 × 4) | Yes |
| 21 | 40 | Shutdown button input (active-low, kernel-owned) | Yes |

### GeeekPi UPS Gen 6
I2C only — address `0x17` (normal mode) / `0x18` (firmware update mode).
Uses GPIO2/3 (shared I2C bus). **No other GPIO pins used.**
GPIO26 `gpio-poweroff` overlay is **not needed** — removed 2026-03-26.

### GeeekPi P33 NVMe+PoE HAT
NVMe via Pi 5 PCIe FPC lane — **zero GPIO header pins used**.
PoE via dedicated circuitry — **zero GPIO header pins used**.
Optional fan controller IC (if fitted) uses I2C at GPIO2/3 (shared bus).

### Waveshare Relay Board B
Uses physical 2-pin header jumpers for GPIO assignment — no soldering needed to move channels.
Active-LOW logic. All outputs claimed by relay_server.py on startup via lgpio.

---

## I2C Bus (GPIO2 SDA / GPIO3 SCL)

| Address | Device | Status |
|---------|--------|--------|
| 0x17 | GeeekPi UPS Gen 6 | Active |
| 0x40 | INA226 battery monitor | Connected — ESP32 firmware active |
| 0x76 | BME280 (on ESP32, not Pi I2C) | Not on Pi I2C bus |

---

## DS18B20 Sensors (1-Wire, GPIO19)

Verified 2026-03-26. Check: `ls /sys/bus/w1/devices/`

| Address | Location | Range |
|---------|----------|-------|
| 28-000000240cbd | Exhaust | ambient–200°C |
| 28-000000251764 | Water | ambient–40°C |
| 28-0000008327eb | Engine | ambient–80°C |
| 28-00000086defe | Cabin | 15–35°C |

---

## Available GPIO for Additional Physical Switches

**Answer: zero additional pins after current plan is complete.**

The 40-pin header is fully committed:
- GPIO0/1: EEPROM reserved
- GPIO2/3: I2C bus
- GPIO4/5: MacArthur UART2
- GPIO6: CH2 relay
- GPIO7–11: MacArthur N2K SPI (physically connected to MCP2518FD — avoid)
- GPIO12/13: MacArthur UART4
- GPIO14/15: **Reserved for CH1/CH3 relay fixes** (when VHF and TP22 are wired)
- GPIO16–18, 24–25: relay outputs
- GPIO19: 1-Wire
- GPIO20–23, 26–27: switch inputs
- GPIO21: kernel shutdown

**If more switch inputs are needed:** Add a **MCP23017 I2C GPIO expander** (address `0x20`–`0x27`, configurable). It gives 16 additional GPIO pins via the existing I2C bus — no new Pi pins required, no HAT stacking.

---

## Pi 5 GPIO Notes

- **GPIO chip:** `gpiochip4` for 40-pin header
- **Voltage:** 3.3V logic only — never apply 5V to any GPIO pin
- **Library:** `lgpio` only — `RPi.GPIO` is not compatible with Pi 5
- **Verify state:** `sudo gpioinfo gpiochip4`
- **UART overlay:** Pi 5 UARTs are `uart2-pi5` / `uart4-pi5` in config.txt (not Pi 4 format)
