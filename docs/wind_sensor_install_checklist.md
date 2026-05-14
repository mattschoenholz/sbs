# Wind Sensor — Install Checklist

Step-by-step from "parts arrived" through "first calibration on the boat".
Pre-flight reading: see [intel_vault: ST60 Wind Transducer ESP32](../../intel_vault/02_Boat_Project/ST60%20Wind%20Transducer%20ESP32.md).

> All bench work happens at the MakerBear Den. Do **not** splice into the
> masthead cable until every box below is ✓ checked.

---

## 0. Parts inventory (when DigiKey/Amazon box arrives)

- [ ] L7808 TO-220 8 V regulator + heatsink (optional — ~0.1 W dissipation)
- [ ] 12 V → 5 V buck converter (separate rail from masthead supply)
- [ ] ADS1115 16-bit I²C ADC breakout
- [ ] 10 kΩ resistor (anemometer pull-up — also use ESP32 internal pull-up as belt+suspenders)
- [ ] Resistor/capacitor kit (assorted)
- [ ] Headers, marine tinned wire, butt connectors with adhesive heat-shrink
- [ ] 10 µF + 0.1 µF caps × 4 (input/output of L7808)
- [ ] ESP32-WROOM (already in stash)
- [ ] Pelican-grade enclosure for nav-station mount

---

## 1. Bench wiring diagram

```
                ┌─────────────────────────────────────────────────────┐
                │ Bench 12 V supply (or boat 12 V bus, fused 10 A)    │
                └────────────────────────┬────────────────────────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          │                             │
              ┌───────────▼───────────┐    ┌────────────▼────────────┐
              │ L7808 TO-220 8 V reg  │    │ 12V → 5V buck converter │
              │ 10µF+0.1µF in & out   │    └────────────┬────────────┘
              └───────────┬───────────┘                 │
                          │ +8 V                        │ +5 V
                          ▼                             ▼
                  Masthead Red                  ESP32 5V & ADS1115 VCC
                                                          │
                                                          ▼
   ST60 masthead colours (5-conductor)         I²C bus
   ────────────────────────────────────         ───────────────────
   Grey   ──→ GND (common bus)                 ESP32 GPIO21 (SDA) ──→ ADS1115 SDA
   Yellow ──→ ESP32 GPIO15  (10kΩ pull-up      ESP32 GPIO22 (SCL) ──→ ADS1115 SCL
                            to 3.3V)
   Blue   ──→ ADS1115 ch0 (cosine)             ADS1115 ADDR ──→ GND  (I²C 0x48)
   Green  ──→ ADS1115 ch1 (sine)
   Red    ──→ L7808 +8 V output
```

All grounds tied: ESP32 GND ↔ ADS1115 GND ↔ L7808 GND ↔ buck GND ↔ masthead Grey.

---

## 2. Bench validation (before any in-cabin install)

Validate each subsystem in isolation. Do **not** combine until a tier passes.

### 2a. Power tier
- [ ] L7808 input: 12.0 V (DMM)
- [ ] L7808 output: 8.0 V ± 0.2 V (DMM, no load)
- [ ] L7808 output: 8.0 V ± 0.2 V (DMM, with masthead connected — should draw ~25 mA)
- [ ] Buck output: 5.0 V ± 0.1 V (DMM)
- [ ] No part of the L7808 case is too hot to touch after 5 min run

### 2b. ESP32 + I²C tier (no masthead connected yet)
- [ ] First USB flash with `esphome upload sv_esperanza_wind.yaml` (USB, NOT OTA)
- [ ] Logs show: `i2c: Found device at 0x48` (ADS1115 detected)
- [ ] `Wind Cos Raw` and `Wind Sin Raw` log values float around mid-rail (not pegged 0V or 5V)
- [ ] WiFi connects, static IP `192.168.42.51` reachable from bearclaw (`ping`)

### 2c. Anemometer tier (still no masthead)
- [ ] Short Yellow line to GND momentarily — `Wind Pulse Hz` logs spike
- [ ] Release — `Wind Pulse Hz` returns to 0

### 2d. Direction sensor tier (masthead connected, vane free to spin)
- [ ] Power up with vane stationary — Blue and Green readings stable, NOT pegged
- [ ] Rotate vane slowly through 360° — Blue and Green sweep ~2.3 V to ~5.9 V each
- [ ] Sin/cos quadrature confirmed: when one is at peak the other is near midpoint
- [ ] `Apparent Wind Angle` log value monotonically advances or retreats (not jumping randomly)

### 2e. Anemometer + masthead together
- [ ] Spin cups by hand — `Wind Pulse Hz` reads roughly 1 Hz per revolution
- [ ] Cups stationary — `Wind Pulse Hz` reads 0 (NOT a ghost signal)
- [ ] `Apparent Wind Speed` rises with spin rate

### 2f. SignalK plumbing
- [ ] `tcpdump -i any -A port 10110` on the Pi shows `$IIMWV,...` arriving at 5 Hz
- [ ] SignalK Data Browser shows `environment.wind.angleApparent` and `environment.wind.speedApparent` updating
- [ ] Helm UI wind tile updates (you'll need the `wind_ui_integration.md` patch applied first)

### 2g. Health monitor + sensor_event endpoint
- [ ] Disconnect Blue at the bench connector — within 60 s, sensor_event POST hits the Pi (`tail -f` of `sensor_events.db` via `sqlite3`)
- [ ] Helm UI status dot turns red, toast appears
- [ ] Reconnect — within 60 s, status returns to ok

### 2h. Calibration services
- [ ] From HA Developer Tools → Services, call `esphome.sv_esperanza_wind_reset_to_factory` — log shows `Calibration RESET to factory defaults`
- [ ] Call `esphome.sv_esperanza_wind_set_heading_zero` while vane is in a known position — log shows `heading_offset` updated to a reasonable value
- [ ] Call `esphome.sv_esperanza_wind_calibrate_direction`, rotate vane through several full turns over 5 min — log shows `Direction cal STORED` with new gains within ~10% of bench defaults

### 2i. Persistence
- [ ] Power-cycle ESP32 — calibration constants survive (check via API, log shows non-default offsets if you ran 2h)

**Only proceed past this line if every box above is checked.**

---

## 3. Flash procedure (OTA, after first USB flash succeeds)

```bash
# From bearclaw, over Tailscale to the boat Pi:
ssh boat 'cd ~/esphome && python3 -m esphome run sv_esperanza_wind.yaml --no-logs'
```

- `--no-logs` is REQUIRED — without it ESPHome hangs waiting for serial.
- ESPHome on the Pi: 2026.2.4 (`request_headers`, NOT `headers`).
- Rollback: previous `.yaml` is in git history; OTA-flash the previous revision to revert.

---

## 4. In-cabin install procedure (at the boat)

- [ ] Identify masthead cable termination at nav station — take a photo of the existing wiring before any change
- [ ] Mount enclosure (Pelican or similar) at nav station, tinned-wire-friendly location
- [ ] Run a fused 12 V tap (10 A inline) from the existing 12 V bus to the enclosure
- [ ] Splice into masthead cable **at the mast base junction box** (NOT the masthead end, NOT cutting the original Raymarine cable)
  - Use marine adhesive heat-shrink butt connectors
  - One conductor at a time, label each with a marker
  - Leave 30 cm slack at the splice for service access
- [ ] Inside the enclosure: same wiring as bench (section 1), but in the marine-grade form
- [ ] Confirm Tailscale reach: from bearclaw → `ping 192.168.42.51`
- [ ] Re-run section 2d, 2e, 2f, 2g on the boat

---

## 5. First calibration on the boat (via the Helm UI)

Pick a calm day in the slip OR motor in flat water with steady wind.

1. **Reset to factory** — Helm UI → Nav Station settings → `<wind-cal-controls>` → "Reset to Factory Defaults".
2. **Direction calibration**:
   - Click "Calibrate Direction (5 min spin)"
   - Log message confirms cal mode entered
   - Either let wind rotate the vane through several full turns over 5 min, OR if becalmed: have a second person rotate the vane by hand from the masthead (only possible at the dock with the mast still up — otherwise wait for wind)
   - After 5 min: log shows `Direction cal STORED` with new offsets/gains
   - If log shows `Direction cal IGNORED — gain too small`: vane didn't move enough. Repeat with more rotation.
3. **Heading zero**:
   - Motor straight into the wind at steady RPM
   - When the boat is well-aligned, click "Set 0° = Current Heading"
   - AWA tile should now read ~0° (within a few degrees due to wind variation)
4. **Smoke-test**: turn boat 90°. AWA should read ~90°. Turn 180°. Should read ~180°. If the sign is flipped, re-run "Set 0° = Current Heading" pointed the other way (or check Blue/Green not swapped — the math test catches this case but the wiring still needs to be right).

---

## 6. Post-install logging

- [ ] Update [intel_vault: Esperanza State](../../intel_vault/02_Boat_Project/Esperanza%20State.md) — flip wind node row to 🟢
- [ ] Update [intel_vault: ST60 Wind Transducer ESP32](../../intel_vault/02_Boat_Project/ST60%20Wind%20Transducer%20ESP32.md) — append a "First-light data" section with: bench cal vs. on-boat cal deltas, anemometer pulses-per-revolution, any deviations from the spec
- [ ] Append to [intel_vault: SailboatServer Updates](../../intel_vault/02_Boat_Project/SailboatServer%20Updates.md) — install date and commissioning notes
- [ ] Note any new gotchas in [intel_vault: brain/Gotchas](../../intel_vault/brain/Gotchas.md)
