# SailboatServer — Changelog

Changes are recorded in reverse chronological order. Each session's changes are grouped together.

---

## Session: 2026-03-27 — Library Page, AI Assistant, Instruments Polish

### New Features

#### Library Page (`library.html`, `css/library.css`, `js/library.js`)
- **New 4th nav page** — `LIBRARY` added to bottom nav via `SBSNav.PAGES` in `sbs-components.js`
- Sections: AI Assistant (top), Offline Library (Kiwix), Navigation References, Engine & Systems, Audiobooks, Admin
- Controls tab renamed → **SYSTEMS**

#### Offline AI Assistant (Option B — Ollama + custom chat panel)
- **Ollama `v0.18.3`** installed on Pi 5 via official installer script (`/usr/local/bin/ollama`)
- **`phi4-mini:latest`** (3.8B, Q4_K_M, 2.5 GB) pulled to `/usr/share/ollama/.ollama/models/`
- systemd service: `ollama.service` — auto-starts, restarts on crash
- **nginx proxy** at `/ollama/` → `http://127.0.0.1:11434/` with `proxy_buffering off` and 300s timeout (required for streaming)
- **CORS fix**: `OLLAMA_ORIGINS=*` set via `/etc/systemd/system/ollama.service.d/override.conf` — without this, browser requests with an `Origin` header get HTTP 403
- Chat panel features: streaming token output, typing indicator, 6 quick-prompt buttons, auto-resizing textarea, Enter to send / Shift+Enter for newline
- **System prompt**: tuned for sailing — COLREGS, Bowditch, Pub. 229, celestial nav, engine troubleshooting, first aid, NMEA data interpretation
- **Live boat context injection**: before every message, a `VESSEL STATE` block is prepended invisibly to the user text. Includes: UTC time, position, SOG/COG/heading, wind (kt + compass direction), depth (ft), barometer (hPa), air/cabin/engine/water temps (°F), active passage summary

#### Kiwix Offline Library
- **`kiwix-tools`** installed via apt; **`kiwix-serve`** running on port 8080
- systemd unit: `kiwix.service` — `ExecStart=/usr/bin/kiwix-serve --port=8080 /home/pi/zims/*.zim`
- **29 ZIM files** loaded from SD card backup, stored at `/home/pi/zims/`
  - 2 corrupted ZIMs (security.stackexchange, wikispecies) moved to `/home/pi/zims-bad/`
- **Kiwix collection cards** are now clickable `<a>` tags linking directly to each ZIM by its Kiwix path prefix (e.g. `/wikipedia_en_all_nopic_2025-12`)
- Added cards for: Outdoors, Medicine, Water Treatment, Food Preparation, Post-Disaster (previously missing)
- **↺ REINDEX button** — calls `POST /system/restart-kiwix` on relay_server. Use after dropping new ZIM files into `/home/pi/zims/`. Sudoers entry at `/etc/sudoers.d/kiwix-restart` grants pi passwordless `systemctl restart kiwix`

#### Autoindex Styling
- nginx `sub_filter` injects a dark-theme `<style>` block into all `/docs/` directory listings
- Dark background (`#0d1117`), blue links, clean monospace font — matches SBS aesthetic

### Bug Fixes / Polish
- **Instruments grid fills full width** — replaced `auto-fill minmax(130px)` with explicit breakpoints: 2 cols → 3 cols (480px) → 4 cols (720px) → 5 cols (960px)
- **Night mode button compact** — `night-toggle .sbs-btn` given reduced padding so it fits the 44px topbar without overflowing
- **Plan map zoom** — map no longer zooms out on every waypoint add; `fitBounds` only fires when route first gets 2 waypoints (`wps.length === 2`)
- **Waypoint hazard markers** — red circle markers when WMS `GetFeatureInfo` detects WRECKS, UWTROC, or OBSTRN within ~200m of a waypoint. Async check runs on add, drag, and initial load
- **Helm page passage** — passage planned on Nav Station now appears on Helm chart and Passage tabs. Root cause: `SBSData.setPassage()` was only called in `portal.js`. Fix: load `sbs-passage` from localStorage at Helm startup
- **Helm weather strip** — replaced fake `sin()` data with Open-Meteo Forecast + Marine API (ocean currents, wave height). 30-min localStorage cache. Strip shows wind (kt + direction), current (kt + direction, cyan), wave height. NOW slot highlighted. Waypoint ETA labels shown when passage active
- **All temperatures → Fahrenheit** — `sbs-data.js` `kToF` conversion; DS18B20 reads `fahrenheit` property from relay API; instrument tiles, helm strip, SK diagnostics all updated
- **Library 404 fix** — `deploy.sh` had hardcoded file list missing `library.html`, `css/library.css`, `js/library.js`. All three added to scp upload lines, remote sudo cp lines, and cache-bust sed line
- **relay_server.py CH3 GPIO pin** — corrected from GPIO 15 → GPIO 13 (hardware jumper physically at GPIO13)

### Infrastructure Changes (Pi)
- **nginx** — added locations: `/ollama/` (proxy), `/docs/` autoindex with sub_filter styling; fixed duplicate location block from previous sed accident
- **Ollama service override** — `/etc/systemd/system/ollama.service.d/override.conf` sets `OLLAMA_ORIGINS=*`
- **Sudoers** — `/etc/sudoers.d/kiwix-restart`: `pi ALL=(ALL) NOPASSWD: /bin/systemctl restart kiwix`; also fixed pre-existing bad permissions on `/etc/sudoers.d/sailboatserver`
- **SD card recovery** — 15 PDFs copied from SD card (`/media/pi/rootfs1/var/www/html/pdfs/`) → `/var/www/html/docs/books/` and `/docs/engine/`; 87GB of ZIM files rsync'd to `/home/pi/zims/` (~80 min at 18 MB/s)

### Files Changed
| File | Type |
|------|------|
| `library.html` | New page |
| `css/library.css` | New stylesheet |
| `js/library.js` | New — Kiwix check, audio browser, AI chat, boat context |
| `js/sbs-components.js` | PAGES array: added Library, renamed Controls→Systems |
| `js/sbs-data.js` | kToF conversion; DS18B20 fahrenheit property; position/passage getters |
| `js/helm.js` | Passage from localStorage; real weather fetch (Open-Meteo + Marine) |
| `js/portal.js` | fitBounds fix; hazard check; Fahrenheit thresholds; resource link cleanup |
| `css/sbs-theme.css` | inst-tiles breakpoints; night-toggle compact |
| `css/helm.css` | Weather strip current/wave/now styles |
| `index.html` | Temp unit °F; Controls→Systems label; removed broken resource links |
| `helm.html` | Temperature label °F |
| `relay_server.py` | CH3 GPIO fix; `/system/restart-kiwix` endpoint |
| `scripts/deploy.sh` | Added library.html/css/js to scp and sudo cp lines |

---

## Session: 2026-03 (prior) — Core Build

_(See git log for earlier changes. Key milestones: WMS tile cache, ESPHome sensors, AIS overlay, passage planning, relay control, DS18B20 temps, NVMe migration.)_
