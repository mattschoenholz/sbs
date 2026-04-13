# SailboatServer — Claude Code / agent instructions

**Vessel:** SV-Esperanza · **Owner:** Matt Schoenholz

This file is the **primary onboarding doc** for AI agents (Claude Code, Cursor, etc.). Read it first, then dive into `docs/AGENT_HANDOFF.md` and `docs/` as needed.

---

## What this repo is

A static web portal + Helm cockpit UI served from a **Raspberry Pi 5** on the boat (`nginx` → `/var/www/html/`). Instruments and AIS come from **SignalK** (WebSocket). Relays and DS18B20 temps come from **`relay_server.py`** (Flask, port 5000). **NOAA ENC** charts are rendered by **MapServer** WMS behind nginx with **FastCGI tile caching**.

Develop on macOS; deploy with `scripts/deploy.sh`.

---

## Documentation map

| File | Use |
|------|-----|
| `docs/AGENT_HANDOFF.md` | Full context: topology, paths on Pi, data flows, credentials table |
| `docs/ARCHITECTURE.md` | Diagrams, nginx/MapServer, frontend module graph |
| `docs/CODEBASE.md` | Per-file guide (`portal.js`, `sbs-chart.js`, etc.) |
| `docs/SERVICES.md` | APIs, hardware, Tailscale, external services (incl. Ollama + Kiwix) |
| `docs/PENDING_WORK.md` | Prioritized roadmap and known bugs |
| `docs/LESSONS_LEARNED.md` | Hard-won rules — read before touching nginx, Ollama, deploy, or GPIO |
| `docs/CHANGELOG.md` | Session-by-session change log |
| `docs/GPIO_PIN_MAPPING.md` | Relay / ESP32 / 1-Wire pins |

---

## Feature Definition Protocol (Required — Outcome-First)

When starting work on any new feature, capability, or UI component — **before writing code, before designing architecture** — define what success looks like.

### The five steps (always in order)

**1. Restate the goal**
One sentence. What does this do for the sailor? Not how it works — what it achieves.

**2. Define acceptance criteria**
3–8 specific, testable boolean conditions that must ALL be true for feature-complete. Each either passes or it doesn't.

**3. Name what's out of scope**
Explicit list of what is NOT tested here. Keeps the feature bounded.

**4. Identify dependencies**
What must be true before testing can begin?

**5. Write the test file**
Create or append to `docs/acceptance-criteria.md`:

~~~markdown
## Feature: <name>

**Goal:** <one sentence>

### Acceptance Criteria
- [ ] <specific, testable boolean condition>
- [ ] ...

### Out of Scope
- <item>

### Dependencies
- <prerequisite>

### How to Test
<step-by-step procedure>
~~~

**Feature complete = every criterion checked off.**

---

## Lessons learned / hard-won rules

### 1. WMS tile cache keys = browser floating-point math (non-negotiable)

nginx’s FastCGI cache key includes the full WMS request URI, especially the **`bbox=`** parameter. That bbox is computed by **Leaflet in the browser** (JavaScript doubles).

- **ARM64** (Pi: Python, Node) and **x86** (Mac Chrome V8) can differ by **1–3 ULP** for the same tile index → **cache miss forever** if you warm with server-side bbox math.

**Rules:**

- **Do not** use `scripts/warm_tile_cache.py` or `warm_tile_cache.mjs` on the Pi to populate the cache for the live portal map. They are **reference only / wrong for this purpose**.
- **Do** use **`warm.html`** in a **desktop browser** (Chrome on x86 Mac is the tested combo). Same engine as typical chart use → bbox matches Leaflet → cache hits.
- Any new “warmer” must compute bbox with the **exact same formula as Leaflet** in JS in a browser, or reuse Leaflet itself.

See `web/warm.html` (tile math) and `web/js/sbs-chart.js` (`L.tileLayer.wms` — Leaflet builds requests).

### 2. ESP32 firmware — preferred development and flashing workflow

**Never use USB unless OTA is broken.** The preferred process for all ESP32 firmware changes:

1. Edit `esphome/sv_esperanza_sensors.yaml` (or `nmea_client.h`) on Mac
2. Run `scripts/deploy.sh` — this syncs the YAML + header to `~/esphome/` on the Pi automatically
3. Flash OTA via Pi (works locally and remotely over Tailscale):
   ```bash
   ssh pi@100.109.248.77 "cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs"
   ```

**Why via Pi, not directly from Mac:**
The ESP32 (192.168.42.50) is only on the boat LAN. The Pi is on both the boat LAN and Tailscale, so it can reach the ESP32 from anywhere. Flashing directly from the Mac only works when the Mac is physically on the boat WiFi.

**Key details:**
- ESPHome is installed on Pi but not in PATH — always use `python3 -m esphome`, not `esphome`
- `--no-logs` is required for remote SSH use — without it ESPHome hangs waiting for serial logs after flash
- `secrets.yaml` is gitignored; `deploy.sh` copies it to the Pi if present locally
- ESP32 static IP: `192.168.42.50` — ESPHome auto-discovers via mDNS or uses the IP directly
- ESPHome version on Pi: 2026.2.4 — `http_request` uses `request_headers` not `headers` (renamed in this version)

**Local OTA (on boat network, no Pi needed):**
```bash
cd esphome && esphome run sv_esperanza_sensors.yaml
```
Mac must be on SV-Esperanza WiFi. ESPHome auto-discovers the ESP32.

### 3. Raspberry Pi 5 GPIO: use `lgpio`, not `RPi.GPIO`

`relay_server.py` uses **`lgpio`**. `RPi.GPIO` is wrong on Pi 5. Relays are **active-LOW** (LOW = ON).

### 4. Deploy and cache-busting

```bash
bash scripts/deploy.sh
# Remote via Tailscale:
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

`deploy.sh` injects `?v=<timestamp>` into HTML references to `.js` / `.css`. **Edit HTML script tags** if you add new bundles so deploy can version them.

### 5. Helm Chart tab — do not blindly reuse `sbs-chart.js`

**Decision (March 2026):** Implement Helm **Chart** panel as a **Leaflet map** (local WMS + ESRI underlay, boat marker, AIS, passage line) — same data sources as the portal map.

**Do not** drop `sbs-chart.js` onto `helm.html` without refactoring: **`web/js/helm.js`** and **`web/js/sbs-chart.js`** both update DOM ids **`chart-sog`**, **`chart-cog`**, **`chart-depth`**, **`chart-tws`**, **`chart-twd`**, **`chart-pos`** — but with **different formatting** (e.g. pills vs numeric-only). Naive reuse **overwrites** Helm overlay copy.

**Preferred approach:** small **`HelmChart`** (or equivalent) in **`web/js/helm.js`**: Leaflet + same WMS options as `sbs-chart.js`, init on **first open** of Chart tab, then **`map.invalidateSize()`** when the tab becomes visible. Optionally later: refactor `sbs-chart.js` to accept a prefix or container config.

### 6. OpenCPN vs SBS web chart

- **SBS portal/helm:** browser → nginx → MapServer WMS → cached tiles. OpenCPN is **not** required for the web UI.
- **OpenCPN on the Pi** (if installed): reads **`/data/charts/noaa_enc/`** S-57 files natively; separate from WMS. Can coexist with MapServer.

### 7. SignalK charts plugin

`/signalk/v1/api/resources/charts` may **404**. `sbs-chart.js` already falls back to **local WMS**. Don’t assume SK charts exist.

### 8. Secrets and keys

- **OpenWeatherMap** key is user-entered in UI → `localStorage` (`sbs-owm-key`). Avoid hardcoding new keys in repo.
- **Tailscale / SSH / router:** see `docs/AGENT_HANDOFF.md` — treat as sensitive.

---

## Repo structure

```
web/          ← everything nginx serves (/var/www/html/)
  *.html      ← portal pages (index, helm, chart, crew, library, warm)
  css/        ← stylesheets
  js/         ← frontend modules
  vendor/     ← Leaflet, leaflet-velocity (bundled, no CDN)
server/       ← Raspberry Pi Flask API
  relay_server.py
  requirements.txt
esphome/      ← ESP32 firmware config
  sv_esperanza_sensors.yaml
  nmea_client.h
  secrets.yaml  (gitignored)
scripts/      ← deploy + maintenance scripts
docs/         ← all documentation + agent specs
  AGENT_HANDOFF.md
  agents/     ← per-domain agent context files
archive/      ← old snapshots (reference only)
CLAUDE.md     ← this file (must stay at root)
package.json  ← npm scripts (serve, deploy)
```

## Frontend load order (portal)

1. Leaflet (+ velocity if needed)
2. `web/js/sbs-data.js`
3. `web/js/sbs-components.js`
4. `web/js/sbs-chart.js`
5. `web/js/portal.js`

**Helm** today: `sbs-data.js`, `sbs-components.js`, `helm.js` only — **no** Leaflet until Chart tab work adds it.

---

## Key files (quick)

| Area | Files |
|------|--------|
| Portal UI | `web/index.html`, `web/js/portal.js`, `web/css/sbs-theme.css` |
| Helm UI | `web/helm.html`, `web/js/helm.js`, `web/css/helm.css` |
| Library / AI | `web/library.html`, `web/js/library.js`, `web/css/library.css` |
| Data / SK | `web/js/sbs-data.js` |
| Map | `web/js/sbs-chart.js`, `web/warm.html` |
| Pi API | `server/relay_server.py`, `server/requirements.txt` |
| ESPHome | `esphome/sv_esperanza_sensors.yaml`, `esphome/nmea_client.h` |
| Deploy | `scripts/deploy.sh` |
| ENC pipeline (on Pi) | `scripts/setup_enc_wms.py` |

---

## When changing the chart stack

- Keep **`LOCAL_WMS_LAYERS`** in sync between **`web/warm.html`** and **`web/js/sbs-chart.js`** (comment in `warm.html` warns about this).
- After changing MapServer layers or coverage, re-run **`web/warm.html`** for affected zoom/region if you rely on a warm cache.

---

## Git

This workspace may not be a git repo on every machine; if you use git, add the usual ignores (`node_modules`, `.env`, large chart artifacts) before committing.
