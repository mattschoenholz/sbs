# GPIO Pin Mapping — SV-Esperanza
**Last updated:** March 2026
**Hardware stack:** Pi 5 (8GB) · MacArthur HAT v1.2 · GeeekPi P33 NVMe+PoE HAT · GeeekPi UPS Gen 6 · Waveshare Relay Board B (8-channel)

> **⚠ TWO ACTIVE CONFLICTS REQUIRE HARDWARE FIX**
> CH1 relay (GPIO5) conflicts with MacArthur UART2 RX — VHF Radio data corrupted.
> CH3 relay (GPIO13) conflicts with MacArthur UART4 RX — TP22 Autotiller data corrupted.
> Both require physical jumper moves on the Waveshare relay board. See Proposed Fix below.

---

## Pi 5 — Complete 40-Pin Header Map

| Phys | BCM | Primary Function  | Assigned To                                          | Status          |
|------|-----|-------------------|------------------------------------------------------|-----------------|
| 1    | —   | 3.3V power        | —                                                    | Power           |
| 2    | —   | 5V power          | —                                                    | Power           |
| 3    | 2   | I2C1 SDA          | UPS Gen 6 (I2C addr 0x17) + P33 HAT fan (shared bus) | I2C shared      |
| 4    | —   | 5V power          | —                                                    | Power           |
| 5    | 3   | I2C1 SCL          | UPS Gen 6 (I2C addr 0x17) + P33 HAT fan (shared bus) | I2C shared      |
| 6    | —   | GND               | —                                                    | Power           |
| 7    | 4   | UART2 TX          | MacArthur HAT — UART2 TX → VHF Radio SH-2150 RX      | **ACTIVE**      |
| 8    | 14  | UART0 TX          | Free — GPS module via USB, UART0 not used             | Free            |
| 9    | —   | GND               | —                                                    | Power           |
| 10   | 15  | UART0 RX          | Free — GPS module via USB, UART0 not used             | Free            |
| 11   | 17  | GPIO              | Relay CH8 — Starlink Power                           | Relay OUT ✓     |
| 12   | 18  | GPIO              | Relay CH7 — Instruments                              | Relay OUT ✓     |
| 13   | 27  | GPIO              | SW5 — Vent Fan manual switch (not yet wired)         | Planned SW      |
| 14   | —   | GND               | —                                                    | Power           |
| 15   | 22  | GPIO              | SW2 — Nav Lights manual switch (not yet wired)       | Planned SW      |
| 16   | 23  | GPIO              | SW3 — Anchor Light manual switch (not yet wired)     | Planned SW      |
| 17   | —   | 3.3V power        | —                                                    | Power           |
| 18   | 24  | GPIO              | Relay CH6 — Vent Fan                                 | Relay OUT ✓     |
| 19   | 10  | SPI0 MOSI         | MacArthur HAT — NMEA 2000 SPI (no N2K hardware)      | Inactive        |
| 20   | —   | GND               | —                                                    | Power           |
| 21   | 9   | SPI0 MISO         | MacArthur HAT — NMEA 2000 SPI (no N2K hardware)      | Inactive        |
| 22   | 25  | GPIO              | Relay CH5 — Water Pump                               | Relay OUT ✓     |
| 23   | 11  | SPI0 CLK          | MacArthur HAT — NMEA 2000 SPI (no N2K hardware)      | Inactive        |
| 24   | 8   | SPI0 CE0          | MacArthur HAT — NMEA 2000 SPI (no N2K hardware)      | Inactive        |
| 25   | —   | GND               | —                                                    | Power           |
| 26   | 7   | SPI0 CE1          | MacArthur HAT — NMEA 2000 SPI (no N2K hardware)      | Inactive        |
| 27   | 0   | ID_SD (EEPROM)    | HAT EEPROM — do not use for GPIO                     | Reserved        |
| 28   | 1   | ID_SC (EEPROM)    | HAT EEPROM — do not use for GPIO                     | Reserved        |
| 29   | 5   | UART2 RX          | **⚠ CONFLICT** MacArthur UART2 RX (VHF in) + Relay CH1 (Cabin Lights) | **FIX REQUIRED** |
| 30   | —   | GND               | —                                                    | Power           |
| 31   | 6   | GPIO / UART2 CTS  | Free — CTS not used for NMEA 0183                    | Free → SW1      |
| 32   | 12  | UART4 TX          | MacArthur HAT — UART4 TX → TP22 Autotiller RX        | **ACTIVE**      |
| 33   | 13  | UART4 RX          | **⚠ CONFLICT** MacArthur UART4 RX (TP22 in) + Relay CH3 (Anchor Light) | **FIX REQUIRED** |
| 34   | —   | GND               | —                                                    | Power           |
| 35   | 19  | 1-Wire            | MacArthur HAT — 1-Wire bus (DS18B20 × 4)             | **ACTIVE**      |
| 36   | 16  | GPIO              | Relay CH4 — Bilge Pump ⚠ SAFETY CRITICAL             | Relay OUT ✓     |
| 37   | 26  | GPIO              | Free → planned SW4 (Cabin Lights switch)             | Free → SW4      |
| 38   | 20  | GPIO              | Free → proposed CH1 relay fix                        | Free → CH1 fix  |
| 39   | —   | GND               | —                                                    | Power           |
| 40   | 21  | GPIO              | Free → proposed CH3 relay fix                        | Free → CH3 fix  |

---

## MacArthur HAT v1.2 — Pin Detail (Pi 5 configuration)

On Pi 5, MacArthur HAT uses **UART2** (VHF Radio) and **UART4** (TP22 Autotiller).
GPS module is connected via USB — UART0 is not used.

| BCM | Phys | Function               | Connected Device           | Active |
|-----|------|------------------------|----------------------------|--------|
| 4   | 7    | UART2 TX (Pi → device) | VHF Radio SH-2150 (RX)     | Yes    |
| 5   | 29   | UART2 RX (device → Pi) | VHF Radio SH-2150 (TX)     | **Yes ⚠ CONFLICT with CH1 relay** |
| 7   | 26   | SPI0 CE1 — N2K CAN     | No N2K hardware            | No     |
| 8   | 24   | SPI0 CE0 — N2K CAN     | No N2K hardware            | No     |
| 9   | 21   | SPI0 MISO — N2K CAN    | No N2K hardware            | No     |
| 10  | 19   | SPI0 MOSI — N2K CAN    | No N2K hardware            | No     |
| 11  | 23   | SPI0 CLK — N2K CAN     | No N2K hardware            | No     |
| 12  | 32   | UART4 TX (Pi → device) | TP22 Autotiller (RX)       | Yes    |
| 13  | 33   | UART4 RX (device → Pi) | TP22 Autotiller (TX)       | **Yes ⚠ CONFLICT with CH3 relay** |
| 14  | 8    | UART0 TX — GPS/AIS     | GPS via USB — not used     | No     |
| 15  | 10   | UART0 RX — GPS/AIS     | GPS via USB — not used     | No     |
| 19  | 35   | 1-Wire bus             | DS18B20 sensors × 4       | Yes    |
| 25  | 22   | N2K interrupt (MCP2518)| No N2K hardware            | No     |

> **1-Wire note:** MacArthur HAT includes 1.6 KΩ pull-up on GPIO19.
> GPIO19 was original Waveshare CH5 default — this conflict triggered the first relay rewiring.

---

## GeeekPi UPS Gen 6 — Pin Detail

**Communication: I2C only. No additional GPIO pins used.**

| BCM | Phys | Function  | Notes                               |
|-----|------|-----------|-------------------------------------|
| 2   | 3    | I2C1 SDA  | Shared I2C bus, address 0x17        |
| 3   | 5    | I2C1 SCL  | Shared I2C bus                      |

> GPIO17 and GPIO18 are **not used** by UPS Gen 6.
> CH7 (GPIO18) and CH8 (GPIO17) relay outputs are **clear**. ✓
> Firmware update mode uses address 0x18 on the same I2C bus.

---

## GeeekPi P33 NVMe+PoE HAT — Pin Detail

| Interface    | GPIO used                          | Notes                             |
|--------------|------------------------------------|-----------------------------------|
| M.2 NVMe     | None — uses Pi 5 PCIe FPC lane     | Not GPIO header                   |
| PoE          | None — dedicated PoE circuitry     | Not GPIO header                   |
| Fan control  | GPIO2/3 (I2C, shared bus)          | If fan controller IC fitted       |

> Full 40-pin GPIO header passes through to stacked HATs.

---

## Waveshare Relay Board B — Pin Assignment

### Current State (has active conflicts)

| CH  | BCM | Phys | Load              | State          |
|-----|-----|------|-------------------|----------------|
| CH1 | 5   | 29   | Cabin Lights      | **⚠ CONFLICT — move to GPIO20** |
| CH2 | 6   | 31   | Navigation Lights | Clear ✓        |
| CH3 | 13  | 33   | Anchor Light      | **⚠ CONFLICT — move to GPIO21** |
| CH4 | 16  | 36   | Bilge Pump        | Clear ✓ SAFETY CRITICAL |
| CH5 | 25  | 22   | Water Pump        | Clear ✓ (N2K interrupt inactive) |
| CH6 | 24  | 18   | Vent Fan          | Clear ✓        |
| CH7 | 18  | 12   | Instruments       | Clear ✓        |
| CH8 | 17  | 11   | Starlink Power    | Clear ✓        |

### Target State (after jumper fix)

| CH  | BCM | Phys | Load              | State   |
|-----|-----|------|-------------------|---------|
| CH1 | **20** | **38** | Cabin Lights   | Clear ✓ |
| CH2 | 6   | 31   | Navigation Lights | Clear ✓ |
| CH3 | **21** | **40** | Anchor Light   | Clear ✓ |
| CH4 | 16  | 36   | Bilge Pump        | Clear ✓ SAFETY CRITICAL |
| CH5 | 25  | 22   | Water Pump        | Clear ✓ |
| CH6 | 24  | 18   | Vent Fan          | Clear ✓ |
| CH7 | 18  | 12   | Instruments       | Clear ✓ |
| CH8 | 17  | 11   | Starlink Power    | Clear ✓ |

**Logic:** Active-LOW — `gpio_write(h, pin, 0)` = ON; `gpio_write(h, pin, 1)` = OFF
**Library:** `lgpio` via `lgpio.gpiochip_open(4)` — Pi 5 uses gpiochip4

---

## Manual Override Switches — Planned (Not Yet Wired)

Toggle switches: one leg → GPIO pin, other leg → GND. Software pull-ups enabled. LOW = ON.

| SW  | Controls CH | Load           | Target GPIO | Phys | Status         |
|-----|-------------|----------------|-------------|------|----------------|
| SW1 | CH4         | Bilge Pump     | **6**       | 31   | Not wired — GPIO6 free (UART2 CTS unused) |
| SW2 | CH2         | Nav Lights     | 22          | 15   | Not wired — clear |
| SW3 | CH3         | Anchor Light   | 23          | 16   | Not wired — clear |
| SW4 | CH1         | Cabin Lights   | **26**      | 37   | Not wired — moved from GPIO24 (now CH6 relay) |
| SW5 | CH6         | Vent Fan       | 27          | 13   | Not wired — clear |

> SW1 was coded to GPIO4 (now MacArthur UART2 TX). Must be recoded to GPIO6 before wiring.
> SW4 was coded to GPIO24 (now CH6 relay). Must be recoded to GPIO26 before wiring.

---

## Conflict History

### Active Conflicts (require hardware fix)

| ID | BCM | Phys | Device A              | Device B                        | Fix                    |
|----|-----|------|-----------------------|---------------------------------|------------------------|
| C1 | 5   | 29   | Relay CH1 OUT         | MacArthur UART2 RX — VHF in    | Move CH1 jumper → GPIO20 (pin 38) |
| C2 | 13  | 33   | Relay CH3 OUT         | MacArthur UART4 RX — TP22 in   | Move CH3 jumper → GPIO21 (pin 40) |

### Code-Only Conflicts (no hardware wired yet)

| ID | BCM | Device A          | Device B           | Fix                            |
|----|-----|-------------------|--------------------|--------------------------------|
| C3 | 4   | SW1 code (GPIO4)  | MacArthur UART2 TX | Recode SW1 → GPIO6             |
| C4 | 24  | SW4 code (GPIO24) | Relay CH6 output   | Recode SW4 → GPIO26            |

### Resolved Conflicts (history)

| GPIO | Original use         | Conflict with             | Resolution                        |
|------|----------------------|---------------------------|-----------------------------------|
| 19   | Waveshare CH5 default| MacArthur 1-Wire          | CH5 jumper moved: 19 → 25         |
| 20   | Waveshare CH6 default| MacArthur UART (Pi 4 era) | CH6 jumper moved: 20 → 24         |
| 24   | Waveshare CH7 default| Freed by CH6 move above   | CH7 jumper moved: 24 → 18         |
| 25   | Waveshare CH8 default| Freed by CH5 move above   | CH8 jumper moved: 25 → 17         |

---

## Available GPIO Pins

All pins free from active assignments, suitable for future sensors, switches, or expansions:

| BCM | Phys | Notes                                         |
|-----|------|-----------------------------------------------|
| 6   | 31   | → **SW1 Bilge switch** (UART2 CTS, not used)  |
| 14  | 8    | Free — UART0 TX not in use (GPS via USB)       |
| 15  | 10   | Free — UART0 RX not in use (GPS via USB)       |
| 20  | 38   | → **CH1 relay fix** target                    |
| 21  | 40   | → **CH3 relay fix** target                    |
| 26  | 37   | → **SW4 Cabin Lights switch**                 |

> GPIO0, GPIO1 (phys 27/28): HAT EEPROM data/clock — do not use.
> GPIO2, GPIO3 (phys 3/5): I2C1 shared bus — fine for I2C sensors (INA226, ZMPT101B), not for general GPIO.
> GPIO25 (phys 22): MacArthur N2K interrupt pin — currently free (no N2K hardware) but reserve for future N2K use.

---

## DS18B20 Sensor Addresses (1-Wire on GPIO19)

Verified 2026-03-08. Check with: `ls /sys/bus/w1/devices/`

| Address         | Location | Typical range |
|-----------------|----------|---------------|
| 28-000000240cbd | Exhaust  | Ambient – 200°C |
| 28-000000251764 | Water    | Ambient – 40°C  |
| 28-0000008327eb | Engine   | Ambient – 80°C  |
| 28-00000086defe | Cabin    | 15 – 35°C       |

---

## Pending Hardware (Not Yet Connected)

| Component  | Interface | Target BCM    | Purpose                          |
|------------|-----------|---------------|----------------------------------|
| INA226     | I2C       | GPIO2/3       | Battery current/power monitoring |
| ZMPT101B   | Analog    | TBD (via ADC) | AC voltage monitoring (shore power / generator) |
| Optocoupler| TBD       | TBD           | Electrical isolation (purpose TBD) |

> INA226 and ZMPT101B will feed the power monitoring panel in the portal UI (future feature).
> ZMPT101B outputs analog — Pi 5 has no ADC; will need an ADS1115 or similar on the I2C bus.

---

## Pi 5 GPIO Reference Notes

- **GPIO chip:** `gpiochip4` for 40-pin header — always use `lgpio.gpiochip_open(4)`
- **Voltage:** 3.3V logic only — do not apply 5V to any GPIO pin
- **lgpio only:** `RPi.GPIO` is not compatible with Pi 5 — use `lgpio`
- **Active-LOW relays:** LOW (0) = relay ON, HIGH (1) = relay OFF
- **MacArthur pull-ups:** 1.6 KΩ pull-up on GPIO19 (1-Wire) is on the HAT PCB
- **I2C bus:** GPIO2/3 is shared between UPS Gen 6, P33 HAT fan, INA226 (future) — all coexist via I2C addressing
