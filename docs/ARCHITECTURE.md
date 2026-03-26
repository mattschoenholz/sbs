# SailboatServer — Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SV-Esperanza                                  │
│                                                                  │
│  ┌──────────────┐    NMEA 0183/2000    ┌──────────────────────┐ │
│  │ Instruments   │──────────────────→  │  SignalK Server      │ │
│  │ (depth,GPS,  │                      │  (port 3000)         │ │
│  │  wind, AP)   │                      │  WebSocket + REST    │ │
│  └──────────────┘                      └──────────┬───────────┘ │
│                                                    │ WS stream   │
│  ┌──────────────┐    NMEA serial       ┌──────────▼───────────┐ │
│  │ ESP32        │──────────────────→   │  sbs-data.js         │ │
│  │ (STW, BME280,│                      │  (browser JS layer)  │ │
│  │  bilge)      │                      └──────────┬───────────┘ │
│  └──────────────┘                                 │             │
│                                                    │             │
│  ┌──────────────┐    1-Wire (GPIO 4)  ┌────────────▼──────────┐ │
│  │ DS18B20 x4   │──────────────────→  │  relay_server.py      │ │
│  │ (temps)      │                     │  Flask (port 5000)    │ │
│  └──────────────┘                     │  GPIO relay control   │ │
│                                       └────────────┬──────────┘ │
│  ┌──────────────┐    lgpio (GPIO)              REST │            │
│  │ Waveshare    │◄─────────────────────────────────┘            │
│  │ 8-ch Relay   │                                               │
│  └──────────────┘                                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  nginx (port 80)                                          │   │
│  │  ├── /              → /var/www/html/ (portal files)      │   │
│  │  ├── /cgi-bin/mapserv → fcgiwrap → MapServer CGI         │   │
│  │  │   (FastCGI cache: /var/cache/nginx/mapserv/)          │   │
│  │  └── Static: no-cache HTML, immutable versioned JS/CSS   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MapServer (CGI) + fcgiwrap (4 workers)                   │   │
│  │  Mapfile: /etc/mapserver/enc.map                          │   │
│  │  Data: /data/charts/enc_merged.gpkg (42MB GeoPackage)     │   │
│  │        /data/charts/soundings.shp                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                     GLiNet Router
                     (192.168.8.x)
                              │
                      ASUS Home Router
                              │
                          Internet
                              │
                         Tailscale
                    (100.109.248.77)
```

---

## Frontend Architecture

### Page Structure

```
index.html (Portal)                    helm.html (Helm Display)
├── <alert-banner>                     ├── <alert-banner>
├── .sbs-statusbar                     ├── .helm-topbar (back btn, clock)
│   └── .controls-toggle               ├── .helm-tabs
├── .controls-drawer (collapsible)     │   ├── Instruments
│   ├── relay-grid                     │   ├── Chart
│   ├── cd-temps                       │   ├── Passage
│   └── cd-bottom-row                  │   └── Weather
├── .sbs-tabs                          └── .helm-panel x4
│   ├── Manage tab                         ├── .inst-layout (tile grid)
│   ├── Plan tab                           ├── chart-container
│   └── Helm tab (→ helm.html)             ├── passage-layout
└── .sbs-panel x2                         └── weather-layout
    ├── Manage panel
    │   ├── .manage-subtabs
    │   └── .manage-sub x4
    │       ├── msub-charts (Leaflet map)
    │       ├── msub-instruments (inst tiles)
    │       ├── msub-weather (forecast)
    │       └── msub-passage (route map, live status, legs)
    └── Plan panel
        ├── passage header + KPIs
        ├── .plan-subtabs
        └── .plan-sub x5
            ├── psub-overview (waypoints, safety)
            ├── psub-windows (departure windows)
            ├── psub-tides
            ├── psub-fuel
            └── psub-watches
```

### JavaScript Module Dependencies

```
sbs-data.js          ← no dependencies, loaded first
    │
sbs-components.js   ← depends on sbs-data.js (SBSData)
    │
sbs-chart.js        ← depends on Leaflet, leaflet-velocity, sbs-data.js
    │
portal.js           ← depends on all above
    │
helm.js             ← depends on sbs-data.js, sbs-components.js only
```

### `sbs-data.js` — Data Layer

**Responsibilities:**
- WebSocket connection to SignalK at `ws://<hostname>:3000/signalk/v1/stream`
- Subscribes to: `navigation.speedOverGround`, `courseOverGroundTrue`, `headingTrue`, `speedThroughWater`, `depth.belowTransducer`, `wind.speedTrue`, `wind.directionTrue`, `wind.speedApparent`, `wind.angleApparent`, `outside.pressure`, `outside.temperature`, `outside.humidity`
- Unit conversions: m/s → knots, radians → degrees, Pa → hPa, K → °C
- AIS vessel tracking (`vessels.*` subscription)
- Passage state machine (nextWPIndex, VMG, ETA, alert generation)
- Relay control API: `GET /relay/status`, `POST /relay/<ch>/on|off`
- Event bus: `SBSData.on('update'|'connected'|'disconnected', callback)`

**Key exports:**
```javascript
SBSData.sog, .cog, .heading, .stw, .depth
SBSData.tws, .twd, .aws, .awa
SBSData.pressure, .temp, .humidity
SBSData.position  // { latitude, longitude }
SBSData.bilge     // boolean
SBSData.vessels   // Map of AIS targets
SBSData.passage   // { nextWPIndex, alerts, vmg, ... }
SBSData.fmt(val, decimals)
SBSData.fmtBearing(deg)
SBSData.on(event, handler) → unsubscribe function
SBSData.setPassage({ waypoints, planSOG, planETA })
SBSData.toggleRelay(channel, state)
```

### `sbs-chart.js` — Map Layer

**Leaflet map configuration:**
- Initial center: `[47.6, -122.3]` (Seattle), zoom 10
- CRS: EPSG:3857 (Web Mercator)

**Base layer sources (cycled with button):**
1. `local` — MapServer WMS (`/cgi-bin/mapserv`) serving NOAA S-57 ENCs. Transparent, overlaid on ESRI underlay.
2. `esri` — ESRI Ocean Basemap tile service
3. `noaa` — NOAA nautical chart tile service (online)

**WMS layers served by MapServer:**
`DEPARE,DEPCNT,LNDARE,COALNE,BCNSPP,BOYSPP,BOYSAW,WRECKS,OBSTRN,LIGHTS,BRIDGE,SOUNDG`

**Overlay layers:**
- OpenSeaMap (buoys, markers) — always on
- OWM layers: `wind_new`, `precipitation_new`, `pressure_new`, `clouds_new`
- GFS wind particles via leaflet-velocity (NOAA ERDDAP GFS data)

**Key exports:**
```javascript
SBSChart.init()
SBSChart.update()
SBSChart.centerOnBoat()
SBSChart.cycleBaseLayer()
SBSChart.toggleWeather()
SBSChart.selectWxLayer(index)   // 0=wind, 1=rain, 2=pressure, 3=clouds
SBSChart.setWeatherApiKey()
SBSChart.toggleGrib()
SBSChart.triggerMOB()
SBSChart.clearMOB()
SBSChart.invalidateSize()       // call after layout changes
```

---

## Backend Architecture

### nginx Configuration (`/etc/nginx/sites-available/default`)

```nginx
# HTML: never cache
location ~* \.html$ {
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}

# Versioned JS/CSS: cache forever (deploy.sh injects ?v=timestamp)
location ~* \.(js|css)$ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}

# MapServer WMS: FastCGI cache (30 days)
location /cgi-bin/mapserv {
  fastcgi_pass unix:/var/run/fcgiwrap.socket;
  fastcgi_cache mapserv;
  fastcgi_cache_valid 200 30d;
  fastcgi_read_timeout 120s;
  fastcgi_param SCRIPT_FILENAME /usr/lib/cgi-bin/mapserv;
  fastcgi_param MS_MAPFILE /etc/mapserver/enc.map;
}
```

Cache zone defined in `/etc/nginx/nginx.conf`:
```nginx
fastcgi_cache_path /var/cache/nginx/mapserv
  levels=1:2 keys_zone=mapserv:20m max_size=500m
  inactive=30d use_temp_path=off;
```

### MapServer (`/etc/mapserver/enc.map`)

Serves NOAA S-57 ENC data as WMS. Key configuration:
- `WMS_ONLINERESOURCE` set to Pi's IP
- `MS_MAPFILE` env var set by nginx `fastcgi_param`
- `WMS_ALLOW_GETMAP_WITHOUT_STYLES "true"` (MapServer 8.0+ security bypass)
- Layers use GPKG connection: `DATA "layername FROM /data/charts/enc_merged.gpkg"`
- SOUNDG layer uses shapefile: `DATA "/data/charts/soundings.shp"`

### relay_server.py Flask API

**Endpoints:**
```
GET  /relay/status              → { "1": {"state":false,"name":"Cabin Lights"}, ... }
POST /relay/<ch>/on             → toggle relay channel on
POST /relay/<ch>/off            → toggle relay channel off
GET  /temperatures              → { "cabin": {"celsius":20.1,"fahrenheit":68.2}, ... }
GET  /hotspot/status            → { "active": true/false }
POST /hotspot/on                → enable wifi hotspot
POST /hotspot/off               → disable wifi hotspot
POST /system/reboot             → reboot Pi
POST /system/shutdown           → shutdown Pi
```

GPIO library: `lgpio` (Raspberry Pi 5 compatible, replaces deprecated RPi.GPIO)  
Relay logic: active LOW (GPIO LOW = relay ON, GPIO HIGH = relay OFF)

---

## NOAA Chart Pipeline

```
NOAA FTP server
    │ download
    ▼
/data/charts/noaa_enc/
(S-57 .000 chart files, PNW region)
    │ ogr2ogr merge → GeoPackage
    ▼
/data/charts/enc_merged.gpkg  (all ENC layers merged, spatial indexes)
    │ ogr2ogr extract SOUNDG
    ▼
/data/charts/soundings.shp   (depth sounding points)
    │
    ▼
/etc/mapserver/enc.map       (WMS service definition)
    │
    ▼
nginx FastCGI cache (/var/cache/nginx/mapserv/)
    │ warmed by
    ▼
warm.html (browser-based tile prefetch — must run in Chrome on x86 Mac)
```

**Why browser-based warming?**  
The nginx cache key includes the WMS `bbox=` parameter. MapServer bbox values are computed by Leaflet.js using IEEE 754 double precision. ARM64 (Pi's Python/Node) and x86-64 (Mac's Chrome V8) produce slightly different results (1-3 ULP difference) for the same tile coordinates due to hardware-level FP differences. Running the warmer in the user's actual browser guarantees cache key matches.

---

## Responsive Design System

All layouts use CSS Grid with `auto-fill`/`minmax()` and `clamp()` for fluid typography.

**Breakpoints (implicit via auto-fill):**
- Phone portrait (<420px): 2-column instrument grid, stacked cards
- Phone landscape / small tablet (420-600px): 3-column grids
- Tablet (600-900px): 4 columns, 2-column passage layout  
- Desktop (900px+): full multi-column layouts

**Key CSS patterns:**
```css
/* Fluid type — scales between min and max */
font-size: clamp(24px, 5.5vw, 52px);

/* Auto-responsive grid */
grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));

/* Full-viewport app shell */
height: 100dvh; /* dynamic viewport height for mobile */
```

---

## Deployment Pipeline

```
Developer edits code in Cursor (macOS)
    │
    ▼
scripts/deploy.sh
    ├── scp files to /tmp/ on Pi
    ├── sudo cp to /var/www/html/ with correct ownership
    ├── inject cache-busting timestamp into HTML ?v= params
    ├── deploy relay_server.py to ~/
    ├── pip3 install dependencies
    ├── systemctl restart relay.service
    └── verify nginx + relay are running

Result: portal live at http://sailboatserver.local
        (or http://100.109.248.77 via Tailscale)
```

**Remote deployment (from any network):**
```bash
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```
