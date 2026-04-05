---
name: flash-esp32
description: Compile and flash ESPHome firmware to the ESP32 sensor node on SV-Esperanza. Handles OTA via Pi (preferred) or USB fallback. Pass "usb" to flash via USB cable, otherwise defaults to OTA.
---

# Flash ESP32 Firmware

Flash `esphome/sv_esperanza_sensors.yaml` to the ESP32 at `192.168.42.50`.

**Mode:** $ARGUMENTS (blank = OTA via Pi, "usb" = direct USB flash from Mac)

---

## Rules before flashing

- **Preferred method is always OTA via Pi** — ESP32 is only on boat LAN; Pi bridges to it from anywhere
- USB flash only if: OTA is broken, new blank ESP32, or you are physically on boat WiFi
- ESPHome is **not in Pi PATH** — always `python3 -m esphome`, never `esphome`
- Always use `--no-logs` for remote SSH — without it ESPHome hangs after flash waiting for serial

---

## Compile first (always)

Compile locally to catch config errors before touching the device:

```bash
cd esphome && python3 -m esphome compile sv_esperanza_sensors.yaml
```

Run this with the Bash tool. If it fails, fix the error before proceeding.

---

## OTA via Pi (default)

When $ARGUMENTS is blank or "ota":

```bash
ssh pi@100.109.248.77 "cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs"
```

The Pi reaches the ESP32 at `192.168.42.50` on the boat LAN. Works locally and over Tailscale.

---

## USB flash (fallback)

When $ARGUMENTS is "usb" — ESP32 must be plugged into Mac via USB:

```bash
cd esphome && python3 -m esphome upload sv_esperanza_sensors.yaml --device /dev/cu.usbserial-0001
```

If `/dev/cu.usbserial-0001` is not found, list available devices:
```bash
ls /dev/cu.usb*
```

---

## After flashing

1. Watch ESPHome logs for sensor readouts — confirm all I2C addresses are discovered
2. Check SignalK for new NMEA sentences (especially after sensor changes)
3. If BME680 IAQ reads "Unreliable" — normal; BSEC2 calibrates over several hours

**Key ESP32 details:**
- Static IP: `192.168.42.50`
- MAC: `6c:c8:40:89:f0:60`
- I2C bus: SDA=GPIO21, SCL=GPIO22
- `secrets.yaml` is gitignored — `deploy.sh` syncs it to Pi automatically
