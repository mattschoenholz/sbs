# Agent: Frontend

**Project:** SailboatServer — SV-Esperanza
**Domain:** HTML, CSS, JavaScript UI, design system implementation, component library

---

## Role

Implement UI changes across the portal and helm interfaces. Translate UX designs into HTML/CSS/JS. Maintain the component library and design system. Ensure cache-busting compliance on deploy.

---

## Page Structure

### Portal (`index.html`)
```
index.html
├── Tab: Manage
│   ├── Sub-tab: Charts        → sbs-chart.js map
│   ├── Sub-tab: Instruments   → instrument tiles grid
│   ├── Sub-tab: Weather       → Open-Meteo forecast
│   └── Sub-tab: Passage       → SVG route map, leg breakdown
└── Tab: Plan
    ├── Sub-tab: Overview
    ├── Sub-tab: Windows       → departure window analysis
    ├── Sub-tab: Tides         → NOAA tides chart
    ├── Sub-tab: Fuel
    └── Sub-tab: Watches
Controls Drawer (global, slides in from right)
    ├── Section: Electrical    → 8 relay toggles
    ├── Section: Temperatures  → DS18B20 readings
    ├── Section: Network       → IPs, Tailscale, hotspot
    └── Section: System        → uptime, CPU temp, reboot
```

### Helm (`helm.html`)
```
helm.html
├── Tab: Instruments  → large responsive tiles grid
├── Tab: Chart        → Leaflet map (P1-01, pending)
├── Tab: Passage      → next waypoint, route list, alerts
└── Tab: Weather      → wind gauge, barometer, 24hr strip
MOB button (always visible)
```

---

## Script Load Order

**Portal (`index.html`):**
1. `vendor/leaflet/leaflet.js`
2. `vendor/leaflet-velocity/leaflet-velocity.min.js`
3. `js/sbs-data.js`
4. `js/sbs-components.js`
5. `js/sbs-chart.js`
6. `js/portal.js`

**Helm (`helm.html`):**
1. `js/sbs-data.js`
2. `js/sbs-components.js`
3. `js/helm.js`
*(Leaflet added when Chart tab is implemented — P1-01)*

**Rules:**
- `sbs-data.js` must load before `sbs-chart.js` and `portal.js`/`helm.js`
- Leaflet must load before `sbs-chart.js`
- When adding new `.js` or `.css` files, add them to HTML with `?v=TIMESTAMP` suffix so `deploy.sh` can version-bust them

---

## CSS Files

| File | Scope |
|------|-------|
| `css/sbs-theme.css` | Full design system: tokens, layout, all portal components |
| `css/helm.css` | Helm-specific overrides (full-screen, large tiles) |

Design tokens are in `css/sbs-theme.css` as CSS custom properties. See `agents/ux-designer.md` for the full token list.

---

## JavaScript Modules

| File | Exports | Notes |
|------|---------|-------|
| `js/sbs-data.js` | `SBSData` singleton | SignalK WS client, passage tracking |
| `js/sbs-components.js` | Custom HTML elements | Registered via `customElements.define()` |
| `js/sbs-chart.js` | `SBSChart` singleton | Leaflet map, all overlays |
| `js/portal.js` | (self-executing) | Portal tabs, relay controls, passage planning |
| `js/helm.js` | (self-executing) | Helm tiles, autopilot, MOB |

---

## Cache-Busting

`scripts/deploy.sh` injects `?v=<timestamp>` into all `.js` and `.css` `<script>`/`<link>` references in HTML files automatically.

**Rule:** Always use `<script src="js/foo.js">` format (not inline). The deploy script parses HTML for these patterns. If you add a new bundle, add it to the HTML with a bare `src=` so deploy can version it.

---

## Component Library (`js/sbs-components.js`)

All components are native custom elements (no framework):

```javascript
// Usage in HTML:
<instrument-cell data-label="SOG" data-unit="kn" data-key="navigation.speedOverGround"></instrument-cell>
<wind-gauge></wind-gauge>
<depth-display></depth-display>
<compass-rose></compass-rose>
<alert-banner></alert-banner>
<night-toggle></night-toggle>
<connection-status></connection-status>
```

Components subscribe to `SBSData` for live updates. Night mode is applied via a class on `<body>`.

---

## Night Mode

- Toggled by `<night-toggle>` component
- Adds/removes `night` class on `<body>`
- CSS in `sbs-theme.css` overrides all colors to amber-only under `body.night`
- State persisted in `localStorage` key `sbs-night-mode`

---

## Responsive Design

- CSS Grid `auto-fill` for instrument tile grids
- `clamp()` for font sizes on instrument values
- Helm: full-screen, tiles fill viewport, `min-height: 0` on grid children
- Portal: fixed sidebar + main content area pattern

---

## Key Rules

- No framework (no React, Vue, etc.) — vanilla JS + custom elements
- No CDN dependencies — all vendor libs in `vendor/`
- No hardcoded API keys in HTML or JS — keys go in `localStorage` via UI
- Night mode must work on every new component
- Touch targets ≥ 44px for any clickable element
