# GPIO Pin Mapping — SV-Esperanza
**Last audited:** 2026-03-26 (live `gpioinfo gpiochip4` verified)
**Hardware stack:** Pi 5 (8GB) · MacArthur HAT v1.2 · GeeekPi P33 NVMe+PoE HAT · GeeekPi UPS Gen 6 · Waveshare Relay Board B (8-channel)

---

## Current GPIO State (verified from live Pi)

All pins confirmed from `sudo gpioinfo gpiochip4` output on 2026-03-26.

### Active Relay Outputs (Waveshare Relay Board B — active LOW)

| BCM | Phys | CH | Load | Jumper history |
|-----|------|----|----|---|
| 22  | 15  | CH1 | Cabin Lights | moved 5→14→22; GPIO14 free for MAIANA |
| 6   | 31  | CH2 | Navigation Lights | clear |
| 23  | 16  | CH3 | Anchor Light | moved 13→15→23; GPIO15 free for MAIANA |
| 16  | 36  | CH4 | Bilge Pump ← SAFETY CRITICAL | clear |
| 25  | 22  | CH5 | Water Pump | rewired 17→25 |
| 24  | 18  | CH6 | Vent Fan | rewired 18→24 |
| 18  | 12  | CH7 | Instruments | rewired 24→18 |
| 17  | 11  | CH8 | Starlink Power | rewired 25→17 |

**Active LOW:** `gpio_write(h, pin, 0)` = ON · `gpio_write(h, pin, 1)` = OFF
**Library:** `lgpio` via `lgpio.gpiochip_open(4)` — Pi 5 uses gpiochip4

### Manual Override Switch Inputs

| Device | GPIO | SW  | Controls | Wiring |
|--------|------|-----|----------|--------|
| Pi     | GPIO20 / pin 38 | SW1 | CH4 Bilge Pump ← SAFETY CRITICAL | → Pi pin 38, other leg → GND |
| Pi     | GPIO26 / pin 37 | SW2 | CH2 Navigation Lights | → Pi pin 37, other leg → GND |
| Pi     | GPIO27 / pin 13 | SW3 | CH3 Anchor Light | → Pi pin 13, other leg → GND |
| ESP32  | GPIO32          | SW4 | CH1 Cabin Lights (non-critical) | → ESP32 GPIO32, other leg → GND |
| ESP32  | GPIO33          | SW5 | CH6 Vent Fan (non-critical) | → ESP32 GPIO33, other leg → GND |

SW1/SW2/SW3: Pi pull-ups, LOW = ON, polled every 100ms — direct, no network dependency.
SW4/SW5: ESP32 pull-ups, on_press POSTs `{"action":"toggle"}` to `/api/relay/<ch>` via HTTP.

GPIO14/15 reserved for MAIANA UART0 — no wires on those pins, no future moves needed.

---

## Latent Conflicts (latent = no conflict until devices are physically wired)

### CH1 — moved to GPIO22 (pin 15) ✓

CH1 jumper moved from GPIO5 (pin 29) → GPIO22 (pin 15). `relay_server.py`: `RELAY_PINS[1] = 22`.
GPIO5 (pin 29) free for MacArthur UART2 RX (VHF radio TX) when physically wired.
GPIO14 (pin 8) free for MAIANA UART0 TX.

### CH3 — moved to GPIO23 (pin 16) ✓

CH3 jumper moved from GPIO13 (pin 33) → GPIO23 (pin 16). `relay_server.py`: `RELAY_PINS[3] = 23`.
GPIO13 (pin 33) free for MacArthur UART4 RX (TP22 autotiller TX) when physically wired.
GPIO15 (pin 10) free for MAIANA UART0 RX.

> Jumper moves require **no soldering** — Waveshare Relay Board B uses 2-pin header jumpers.

### MAIANA AIS Transponder — UART0 ready ✓

GPIO14 (UART0 TX) and GPIO15 (UART0 RX) are **free**. CH1/CH3 relays moved to GPIO22/23.

When MAIANA arrives — no relay moves, no switch moves, no code changes:
1. Wire MAIANA TX → Pi GPIO15 (pin 10), MAIANA RX → Pi GPIO14 (pin 8)
2. Add `dtoverlay=uart0-pi5` to `/boot/firmware/config.txt`, reboot
3. Add SignalK serial connection on `/dev/ttyAMA0` at 38400 baud

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
| 13 | CH3 (Anchor Light) blocked UART4 RX — TP22 autotiller TX would conflict | CH3 jumper moved: 13→15→23 | 2026-03-29 |
| 5  | CH1 (Cabin Lights) blocked UART2 RX — VHF radio TX would conflict | CH1 jumper moved: 5→14→22 | 2026-03-29 |
| 22 | SW2 (Nav Lights) was here; CH1 relay moved here instead | SW2 moved to Pi GPIO26; GPIO14 freed for MAIANA | 2026-03-29 |
| 23 | SW3 (Anchor Light) was here; CH3 relay moved here instead | SW3 moved to Pi GPIO27; GPIO15 freed for MAIANA | 2026-03-29 |
| 26 | gpio-poweroff overlay + planned SW4 (Cabin Lights) | gpio-poweroff removed; SW4 moved to ESP32 GPIO32 — GPIO26 now SW2 | 2026-03-29 |
| 27 | Planned SW5 (Vent Fan) on Pi | SW5 moved to ESP32 GPIO33 — GPIO27 now SW3 | 2026-03-29 |

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
| 8  | 14 | UART0 TX | **Free — reserved for MAIANA UART0 TX** | free |
| 9  | —  | GND | Power | — |
| 10 | 15 | UART0 RX | **Free — reserved for MAIANA UART0 RX** | free |
| 11 | 17 | GPIO | Relay CH8 — Starlink Power | Relay OUT |
| 12 | 18 | GPIO | Relay CH7 — Instruments | Relay OUT |
| 13 | 27 | GPIO | SW3 — Anchor Light switch | Switch IN |
| 14 | —  | GND | Power | — |
| 15 | 22 | GPIO | Relay CH1 — Cabin Lights | Relay OUT |
| 16 | 23 | GPIO | Relay CH3 — Anchor Light | Relay OUT |
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
| 29 | 5  | UART2 RX | MacArthur UART2 RX ← VHF Radio SH-2150 (CH1 freed) | When VHF wired |
| 30 | —  | GND | Power | — |
| 31 | 6  | GPIO | Relay CH2 — Navigation Lights | Relay OUT |
| 32 | 12 | UART4 TX | MacArthur HAT → TP22 Autotiller (RX) | ACTIVE |
| 33 | 13 | UART4 RX | MacArthur UART4 RX ← TP22 Autotiller (CH3 freed) | When TP22 wired |
| 34 | —  | GND | Power | — |
| 35 | 19 | 1-Wire | MacArthur HAT — DS18B20 × 4 (1.6kΩ pull-up on HAT) | ACTIVE |
| 36 | 16 | GPIO | Relay CH4 — Bilge Pump ← SAFETY CRITICAL | Relay OUT |
| 37 | 26 | GPIO | SW2 — Nav Lights switch | Switch IN |
| 38 | 20 | GPIO | SW1 — Bilge Pump switch ← SAFETY CRITICAL | Switch IN |
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

**Answer: zero additional Pi header pins available after current plan.**

The 40-pin header is fully committed:
- GPIO0/1: EEPROM reserved
- GPIO2/3: I2C bus
- GPIO4/5: MacArthur UART2
- GPIO6: CH2 relay
- GPIO7–11: MacArthur N2K SPI (physically connected to MCP2518FD — avoid)
- GPIO12/13: MacArthur UART4
- GPIO14/15: **free — reserved for MAIANA UART0**
- GPIO16–18, 24–25: relay outputs
- GPIO19: 1-Wire
- GPIO20, 26, 27: switch inputs (SW1 bilge, SW2 nav lights, SW3 anchor light)
- GPIO21: kernel shutdown
- GPIO22/23: CH1/CH3 relay outputs

**Additional switches → use ESP32:** GPIO32/33 are in use for SW4/SW5. ESP32 also has GPIO5, GPIO13–17, GPIO19, GPIO23, GPIO25 free for more digital inputs if needed — no Pi pins required.

---

## Pi 5 GPIO Notes

- **GPIO chip:** `gpiochip4` for 40-pin header
- **Voltage:** 3.3V logic only — never apply 5V to any GPIO pin
- **Library:** `lgpio` only — `RPi.GPIO` is not compatible with Pi 5
- **Verify state:** `sudo gpioinfo gpiochip4`
- **UART overlay:** Pi 5 UARTs are `uart2-pi5` / `uart4-pi5` in config.txt (not Pi 4 format)
