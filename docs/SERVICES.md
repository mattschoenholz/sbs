# SailboatServer — Services, APIs & Hardware Reference

## Web Services

### SignalK (On-Pi)
- **URL:** `http://sailboatserver.local:3000`
- **Purpose:** NMEA data aggregation hub. Ingests NMEA 0183 from serial ports, provides normalized REST and WebSocket API.
- **WebSocket:** `ws://sailboatserver.local:3000/signalk/v1/stream`
- **REST:** `http://sailboatserver.local:3000/signalk/v1/api/`
- **Admin:** `http://sailboatserver.local:3000` → web UI
- **Version:** 2.x (2.23.0 update available as of March 2026)
- **Installed plugins:**
  - SignalK Charts Plugin (WMS/chart tiles) — note: charts endpoint returns 404, app falls back to local WMS
  - Autopilot integration
- **Key SignalK paths used:**
  ```
  navigation.speedOverGround          (SOG, m/s)
  navigation.courseOverGroundTrue     (COG, radians)
  navigation.headingTrue              (HDG, radians)
  navigation.speedThroughWater        (STW, m/s)
  environment.depth.belowTransducer   (depth, meters)
  environment.wind.speedTrue          (TWS, m/s)
  environment.wind.angleTrue          (TWD, radians from N)
  environment.wind.speedApparent      (AWS, m/s)
  environment.wind.angleApparent      (AWA, radians, +/- from bow)
  environment.outside.pressure        (barometer, Pa)
  environment.outside.temperature     (outside temp, K)
  environment.outside.humidity        (relative humidity, ratio 0-1)
  environment.outside.illuminance     (lux — from ESP32 BH1750FVI)
  navigation.position                 (lat/lon)
  vessels.*                           (AIS targets)
  ```

### relay_server.py (On-Pi, custom)
- **URL:** `http://sailboatserver.local:5000`
- **Purpose:** GPIO relay control, temperature sensing, system management
- **Language:** Python 3 / Flask + flask-cors
- **systemd unit:** `relay.service`
- **Managed by:** `scripts/deploy.sh` (deploys from Mac to Pi home dir)
- **GPIO library:** `lgpio` (Pi 5 compatible)
- **Endpoints:** See `docs/ARCHITECTURE.md` for full endpoint list

### Ollama (On-Pi)
- **URL:** `http://sailboatserver.local:11434` (direct) or `http://sailboatserver.local/ollama/` (nginx proxy)
- **Purpose:** Local LLM inference for offline AI sailing assistant
- **Model:** `phi4-mini:latest` — 3.8B params, Q4_K_M quantization, 2.5 GB
- **Model storage:** `/usr/share/ollama/.ollama/models/`
- **systemd unit:** `ollama.service`
- **CORS config:** `/etc/systemd/system/ollama.service.d/override.conf` — sets `OLLAMA_ORIGINS=*` (required for browser access)
- **nginx proxy:** `location /ollama/` → `http://127.0.0.1:11434/` with `proxy_buffering off`, `proxy_read_timeout 300s`
- **Key endpoints:**
  - `GET /ollama/api/tags` — list loaded models
  - `POST /ollama/api/chat` — chat with streaming NDJSON response
- **Adding models:** `ssh pi@sailboatserver.local "ollama pull <model-name>"`

### Kiwix (On-Pi)
- **URL:** `http://sailboatserver.local:8080`
- **Purpose:** Offline Wikipedia, WikiBooks, iFixit, StackExchange, Gutenberg and survival guides
- **ZIM files:** `/home/pi/zims/*.zim` — 29 collections (~87 GB total)
- **systemd unit:** `kiwix.service` — `ExecStart=/usr/bin/kiwix-serve --port=8080 /home/pi/zims/*.zim`
- **Adding content:** Drop `.zim` files into `/home/pi/zims/`, then tap ↺ REINDEX on Library page (or `sudo systemctl restart kiwix`)
- **ZIM source:** https://library.kiwix.org
- **Sudoers:** `/etc/sudoers.d/kiwix-restart` — pi user can `sudo systemctl restart kiwix` without password (used by relay_server restart endpoint)
- **Bad ZIMs:** Two corrupted files in `/home/pi/zims-bad/` (security.stackexchange, wikispecies) — can be re-downloaded

### nginx (On-Pi)
- **Port:** 80
- **Purpose:** Static file serving, FastCGI proxy for MapServer, caching
- **Config:** `/etc/nginx/sites-available/default`
- **Cache zone:** `/var/cache/nginx/mapserv/` — WMS tile cache (30 days, ~500MB max)

### MapServer (On-Pi)
- **Invoked by:** nginx via fcgiwrap FastCGI
- **Path:** `/usr/lib/cgi-bin/mapserv`
- **Mapfile:** `/etc/mapserver/enc.map`
- **Purpose:** Renders NOAA S-57 ENC charts as WMS tiles
- **Setup script:** `scripts/setup_enc_wms.py` → run on Pi to rebuild after new ENC downloads

---

## External APIs

### Open-Meteo
- **URL:** `https://api.open-meteo.com/v1/forecast`
- **Cost:** Free (no API key required)
- **Used for:** Hourly weather forecast for passage planning and passage alerts
- **Data fetched:**
  ```
  hourly: windspeed_10m, winddirection_10m, precipitation_probability,
          precipitation, weathercode, temperature_2m, cloudcover
  ```
- **Wind unit:** knots (`wind_speed_unit=kn`)
- **Called from:** `portal.js` `fetchWeather()` — triggered on passage tab activation
- **Forecast horizon:** 7 days hourly
- **Alert thresholds:**
  - Wind ≥ 25 kn → Advisory (orange)
  - Wind ≥ 34 kn → Urgent/Gale (red)
  - Precip ≥ 60% → Advisory
  - Weather code 95-99 (thunderstorm) → Urgent
- **WMO weather codes:** 0=clear, 1-3=partly cloudy, 45-48=fog, 51-67=rain, 71-77=snow, 80-82=showers, 95-99=thunderstorm

### OpenWeatherMap (OWM)
- **URL:** `https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid={key}`
- **Cost:** Free tier (1M calls/month)
- **API Key:** `REDACTED_OWM_KEY` (stored in localStorage `sbs-owm-key`)
- **Key entry:** Prompted via UI when "Set API Key" button clicked in chart overlays
- **Layers available:**
  - `wind_new` — Wind speed/direction
  - `precipitation_new` — Precipitation
  - `pressure_new` — Atmospheric pressure
  - `clouds_new` — Cloud cover
- **Used from:** `sbs-chart.js` `selectWxLayer()` / `toggleWeather()`

### NOAA GFS via ERDDAP (GRIB wind particles)
- **URL:** `https://coastwatch.pfeg.noaa.gov/erddap/griddap/...`
- **Cost:** Free (NOAA public data)
- **No API key required**
- **Data:** Global Forecast System wind data (0.25° or 0.5° grid)
- **Format:** JSON array for u/v wind components → `leaflet-velocity` input format
- **Used from:** `sbs-chart.js` `toggleGrib()` — animated wind particle overlay

### NOAA Tides
- **URL:** `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- **Cost:** Free (no key required)
- **Used for:** Tide predictions in Plan > Tides subtab
- **Station:** User selects NOAA station ID (nearest to departure/destination)
- **Called from:** `portal.js` tide rendering functions

### ESRI Ocean Basemap
- **URL:** `https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`
- **Cost:** Free for non-commercial/attribution use
- **Used as:** Chart background tile layer (falls back when no local WMS)

### NOAA Raster Nautical Charts (RNC online)
- **URL:** `https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png`
- **Cost:** Free (NOAA public)
- **Used as:** Alternative base chart layer option

### OpenSeaMap
- **URL:** `https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png`
- **Cost:** Free (OpenStreetMap-based)
- **Used as:** Always-on overlay for buoys, aids to navigation symbols

### Tailscale
- **Purpose:** Zero-config mesh VPN for remote Pi access
- **Pi Tailscale IP:** `100.109.248.77`
- **Mac Tailscale IP:** `100.83.131.77`
- **Admin portal:** `https://login.tailscale.com/admin`
- **MagicDNS hostname (once enabled):** `sailboatserver.local.tailnet-name.ts.net`
- **Usage:** SSH to Pi from any network; remote deployment via `PI_HOST=100.109.248.77 bash scripts/deploy.sh`

---

## Hardware Components

### Raspberry Pi 5 (8GB)
- **Role:** Main boat computer and web server
- **OS:** Raspberry Pi OS Bookworm arm64
- **Storage:** NVMe SSD (M.2 2280) via HAT, cloned from SD card
- **Boot order:** NVMe first (configured via `rpi-eeprom-config`)
- **Swap:** Configured on NVMe via `/etc/dphys-swapfile`

### Waveshare Relay Board B (8-channel)
- **Interface:** GPIO direct (active-LOW logic)
- **Manual override:** 5 physical switches wired to GPIO input pins
- **Channels and assignments:** See `AGENT_HANDOFF.md` relay pin table
- **Note:** CH4 (Bilge Pump) is safety-critical — never disable unexpectedly

### ESP32 Sensor Node
- **Device:** ESP32-WROOM, static IP `192.168.42.50`
- **Firmware:** ESPHome — `esphome/sv_esperanza_sensors.yaml`
- **Protocol:** NMEA 0183 sentences → SignalK TCP port 10110 (WiFi, not USB)
- **OTA flash:** `ssh pi@100.109.248.77 "cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs"`
- **Sensors (active):**
  - BMP280 (I2C 0x77): barometric pressure
  - AHT20 (I2C 0x38): air temperature, humidity
  - BH1750FVI (I2C 0x23): ambient light / lux — **wiring pending (sensor at boat)**
  - INA226 (I2C 0x40): battery voltage, current, power
  - Paddlewheel (GPIO4): speed through water (STW)
  - Bilge water sensor (GPIO26): moisture binary
  - Engine RPM (GPIO18): optocoupler on alternator W terminal
  - AC shore power (GPIO34): ZMPT101B voltage sensor
- **Manual override switches (non-critical — HTTP POST to relay_server):**
  - SW4 Cabin Lights → GPIO32 → `POST /api/relay/1 {"action":"toggle"}`
  - SW5 Vent Fan → GPIO33 → `POST /api/relay/6 {"action":"toggle"}`
- **NMEA sentences emitted:** `$IIVHW` (STW), `$IIMDA` (pressure/temp/humidity), `$IIXDR` (air temp, humidity, battery voltage/current, lux), `$IIRPM` (engine RPM)
- **Key details:**
  - ESPHome 2026.2.4 on Pi — `http_request` uses `request_headers` (not `headers`)
  - `python3 -m esphome` required on Pi (not in PATH as `esphome`)
  - `--no-logs` required for SSH flash sessions

### Waveshare ESP32-S3 Watch *(firmware scaffolded — hardware not yet configured)*
- **Device:** Waveshare ESP32-S3-Touch-AMOLED-2.06 (240×536 AMOLED, capacitive touch)
- **Firmware:** Arduino + LVGL — `watch/src/main.cpp`
- **Build:** PlatformIO — `watch/platformio.ini`
- **Connectivity:** WiFiMulti (SV-Esperanza primary, phone hotspot fallback)
- **Data sources:** SignalK WebSocket (`ws://sailboatserver.local:3000/signalk/v1/stream`), relay_server HTTP API
- **Three modes:**
  - Autopilot — ±1°/±10° heading, engage/disengage
  - Instruments — SOG, COG, STW, depth, TWS, TWA, battery (2-col tile grid)
  - Anchor — relay toggle buttons (all 8 channels), SOG drag warning
- **Secrets:** auto-generated from `esphome/secrets.yaml` via `python3 scripts/gen_watch_secrets.py`
- **Pending:** RM67162 display driver init, CST816S touch driver, autopilot command PUT path

### DS18B20 Temperature Sensors (4x)
- **Interface:** 1-Wire bus on GPIO 4
- **Locations:** Cabin, Engine room, Exhaust, Water
- **Driver:** Linux kernel 1-Wire driver (`/sys/bus/w1/devices/28-*/w1_slave`)
- **Read by:** `relay_server.py` `get_temps()` function via glob on `/sys/bus/w1/`

### GL.iNet Router
- **Model:** (pocket travel router)
- **LAN:** `192.168.42.x`
- **Admin:** `http://192.168.42.1`
- **Purpose:** Boat WiFi access point; Ethernet uplink to Pi
- **Relay server integration:** `relay_server.py` can reboot WiFi via GL.iNet API
- **SSH credentials:** root@192.168.42.1 (stored in `relay_server.py` config)

### Starlink
- **Control:** CH8 relay (power cycling)
- **Status endpoint:** `relay_server.py` queries Starlink dishy API over local network
- **Status file:** `starlink_endpoints.py` (Starlink API endpoint definitions)

---

## Software Dependencies

### Pi System Packages
```bash
nginx
fcgiwrap
mapserver-bin cgi-mapserver
gdal-bin python3-gdal
python3-flask python3-requests
lgpio
signalk-server (npm global)
tailscale
```

### Python Packages (`requirements.txt`)
```
flask
flask-cors
lgpio
paramiko     # GL.iNet SSH control
requests
```

### Frontend Vendor Libraries (`vendor/`)
```
vendor/leaflet/
  leaflet.js            v1.9.x  — Interactive maps
  leaflet.css
  images/               — Default marker icons

vendor/leaflet-velocity/
  leaflet-velocity.min.js   — Animated wind particle overlay
  leaflet-velocity.min.css
```
Both are bundled locally (no CDN dependency on boat network).

### Browser Requirements
- Any modern browser (Chrome, Firefox, Safari, Edge)
- **Chrome on x86 Mac recommended** for running `warm.html` (cache warmer) due to floating-point precision requirement
- No service worker or offline caching (portal requires Pi network access)

---

## Local OpenCPN Installation
- **Installed on Pi:** Yes
- **Purpose:** Backup chart plotter, can use same NOAA ENCs
- **Chart directory:** `/data/charts/noaa_enc/` (shared with MapServer)
- **Note:** OpenCPN and MapServer/nginx can coexist; both read the same S-57 files
- **Polar data:** Not yet loaded (needed for weather routing)
- **Weather routing plugin:** Not yet configured (pending task)
