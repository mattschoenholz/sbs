# SailboatServer — Claude Code / agent instructions

**Vessel:** SV-Esperanza · **Owner:** Matt Schoenholz

This file is the **primary onboarding doc** for AI agents (Claude Code, Cursor, etc.). Read it first, then dive into `AGENT_HANDOFF.md` and `docs/` as needed.

---

## What this repo is

A static web portal + Helm cockpit UI served from a **Raspberry Pi 5** on the boat (`nginx` → `/var/www/html/`). Instruments and AIS come from **SignalK** (WebSocket). Relays and DS18B20 temps come from **`relay_server.py`** (Flask, port 5000). **NOAA ENC** charts are rendered by **MapServer** WMS behind nginx with **FastCGI tile caching**.

Develop on macOS; deploy with `scripts/deploy.sh`.

---

## Documentation map

| File | Use |
|------|-----|
| `AGENT_HANDOFF.md` | Full context: topology, paths on Pi, data flows, credentials table |
| `docs/ARCHITECTURE.md` | Diagrams, nginx/MapServer, frontend module graph |
| `docs/CODEBASE.md` | Per-file guide (`portal.js`, `sbs-chart.js`, etc.) |
| `docs/SERVICES.md` | APIs, hardware, Tailscale, external services |
| `docs/PENDING_WORK.md` | Prioritized roadmap and known bugs |
| `docs/GPIO_PIN_MAPPING.md` | Relay / ESP32 / 1-Wire pins |

---

## Lessons learned / hard-won rules

### 1. WMS tile cache keys = browser floating-point math (non-negotiable)

nginx’s FastCGI cache key includes the full WMS request URI, especially the **`bbox=`** parameter. That bbox is computed by **Leaflet in the browser** (JavaScript doubles).

- **ARM64** (Pi: Python, Node) and **x86** (Mac Chrome V8) can differ by **1–3 ULP** for the same tile index → **cache miss forever** if you warm with server-side bbox math.

**Rules:**

- **Do not** use `scripts/warm_tile_cache.py` or `warm_tile_cache.mjs` on the Pi to populate the cache for the live portal map. They are **reference only / wrong for this purpose**.
- **Do** use **`warm.html`** in a **desktop browser** (Chrome on x86 Mac is the tested combo). Same engine as typical chart use → bbox matches Leaflet → cache hits.
- Any new “warmer” must compute bbox with the **exact same formula as Leaflet** in JS in a browser, or reuse Leaflet itself.

See `warm.html` (tile math) and `js/sbs-chart.js` (`L.tileLayer.wms` — Leaflet builds requests).

### 2. Raspberry Pi 5 GPIO: use `lgpio`, not `RPi.GPIO`

`relay_server.py` uses **`lgpio`**. `RPi.GPIO` is wrong on Pi 5. Relays are **active-LOW** (LOW = ON).

### 3. Deploy and cache-busting

```bash
bash scripts/deploy.sh
# Remote via Tailscale:
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

`deploy.sh` injects `?v=<timestamp>` into HTML references to `.js` / `.css`. **Edit HTML script tags** if you add new bundles so deploy can version them.

### 4. Helm Chart tab — do not blindly reuse `sbs-chart.js`

**Decision (March 2026):** Implement Helm **Chart** panel as a **Leaflet map** (local WMS + ESRI underlay, boat marker, AIS, passage line) — same data sources as the portal map.

**Do not** drop `sbs-chart.js` onto `helm.html` without refactoring: **`helm.js`** and **`sbs-chart.js`** both update DOM ids **`chart-sog`**, **`chart-cog`**, **`chart-depth`**, **`chart-tws`**, **`chart-twd`**, **`chart-pos`** — but with **different formatting** (e.g. pills vs numeric-only). Naive reuse **overwrites** Helm overlay copy.

**Preferred approach:** small **`HelmChart`** (or equivalent) in **`helm.js`**: Leaflet + same WMS options as `sbs-chart.js`, init on **first open** of Chart tab, then **`map.invalidateSize()`** when the tab becomes visible. Optionally later: refactor `sbs-chart.js` to accept a prefix or container config.

### 5. OpenCPN vs SBS web chart

- **SBS portal/helm:** browser → nginx → MapServer WMS → cached tiles. OpenCPN is **not** required for the web UI.
- **OpenCPN on the Pi** (if installed): reads **`/data/charts/noaa_enc/`** S-57 files natively; separate from WMS. Can coexist with MapServer.

### 6. SignalK charts plugin

`/signalk/v1/api/resources/charts` may **404**. `sbs-chart.js` already falls back to **local WMS**. Don’t assume SK charts exist.

### 7. Secrets and keys

- **OpenWeatherMap** key is user-entered in UI → `localStorage` (`sbs-owm-key`). Avoid hardcoding new keys in repo.
- **Tailscale / SSH / router:** see `AGENT_HANDOFF.md` — treat as sensitive.

---

## Frontend load order (portal)

1. Leaflet (+ velocity if needed)  
2. `js/sbs-data.js`  
3. `js/sbs-components.js`  
4. `js/sbs-chart.js`  
5. `js/portal.js`  

**Helm** today: `sbs-data.js`, `sbs-components.js`, `helm.js` only — **no** Leaflet until Chart tab work adds it.

---

## Key files (quick)

| Area | Files |
|------|--------|
| Portal UI | `index.html`, `js/portal.js`, `css/sbs-theme.css` |
| Helm UI | `helm.html`, `js/helm.js`, `css/helm.css` |
| Data / SK | `js/sbs-data.js` |
| Map | `js/sbs-chart.js`, `warm.html` |
| Pi API | `relay_server.py`, `requirements.txt` |
| Deploy | `scripts/deploy.sh` |
| ENC pipeline (on Pi) | `scripts/setup_enc_wms.py` (mapfile + GPKG path in docs) |

---

## When changing the chart stack

- Keep **`LOCAL_WMS_LAYERS`** in sync between **`warm.html`** and **`js/sbs-chart.js`** (comment in `warm.html` warns about this).
- After changing MapServer layers or coverage, re-run **`warm.html`** for affected zoom/region if you rely on a warm cache.

---

## Git

This workspace may not be a git repo on every machine; if you use git, add the usual ignores (`node_modules`, `.env`, large chart artifacts) before committing.
