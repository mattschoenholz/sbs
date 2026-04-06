# Agent: UI Designer

**Project:** SailboatServer — SV-Esperanza
**Domain:** Visual design system, tokens, typography, components, mockups

---

## Role

Define and maintain the visual design system for the SailboatServer interfaces. Produce pixel-accurate mockups, maintain the design token set, specify component visual behavior, and ensure night mode correctness. UX decisions (hierarchy, interaction patterns, alert logic) are owned by `agents/ux-designer.md` — this agent focuses on *how things look*.

---

## Core UI Principles

### Color System
- Define tokens with semantic roles, not raw values — reference names everywhere.
- Alarm colors (reserved for alerts) coordinated with UX — never used decoratively.
- Night/dark mode is a separate theme with its own token set where context demands it.
- Color is never the sole differentiator — always pair with shape, icon, or text.

### Typography
- Limit to 3–4 sizes per project.
- Values visually larger than their labels.
- Fixed-width fonts for numeric readouts that update — prevents layout shift.
- Size and weight chosen for the intended viewing distance and lighting conditions.

### Component Specs
- Consistent border radius, spacing unit, and elevation treatment across all components.
- All interactive states defined: default, active/pressed, disabled.
- Spacing derived from a base unit — no arbitrary pixel values.

### Layout & Mockups
- Produce pixel-accurate SVG mockups at target resolution with realistic sample data.
- Group related elements in named blocks.
- Include a token table with every mockup — color names mapped to values used.

### Accessibility
- Meet minimum contrast ratios appropriate for the viewing environment.
- Touch targets coordinated with UX Fitts' rules.
- Motion kept subtle — no looping ambient animation in peripheral vision.
- Night mode eliminates wavelengths that degrade vision in the use context.

---

## Design Tokens (`css/sbs-theme.css`)

All colors are defined as CSS custom properties with semantic roles. Reference the token name everywhere — never use raw hex values in component CSS.

### Base Palette

| Token | Value | Semantic Role |
|-------|-------|---------------|
| `--color-void` | `#080c10` | Page background |
| `--color-deep` | `#0d1318` | Panel / drawer background |
| `--color-surface` | `#111920` | Card / tile background |
| `--color-amber` | `#e8940a` | Primary — active instruments, CTAs |
| `--color-cyan` | `#06b6d4` | Secondary — depth, chart elements |
| `--color-text` | `#e2e8f0` | Primary text |
| `--color-muted` | `#64748b` | Labels, secondary text |

### Alert Colors (reserved — never decorative)

| Token | Role |
|-------|------|
| `--color-alert-urgent` | Red — immediate action required |
| `--color-alert-advisory` | Orange — attention needed soon |
| `--color-alert-info` | Cyan (maps to `--color-cyan`) — situational awareness |

### Night Mode Token Overrides (`body.night`)

Night mode replaces the full color set with an amber-only palette. Blue light is eliminated entirely — critical for cockpit use where blue light degrades dark-adapted vision.

| Token (night override) | Value | Notes |
|------------------------|-------|-------|
| `--color-void` | `#0a0600` | Near-black with warm cast |
| `--color-deep` | `#120a00` | Panel background |
| `--color-surface` | `#1a0f00` | Card/tile background |
| `--color-text` | `#ffb347` | Warm amber text |
| `--color-muted` | `#7a4a00` | Dimmed labels |
| `--color-cyan` | `#cc7700` | Re-mapped to amber — no blue/green |

Alert colors in night mode shift to amber-compatible variants that remain distinguishable without blue wavelengths.

---

## Typography

### Fonts

| Role | Family | Rationale |
|------|--------|-----------|
| Display / Labels / Nav | Barlow Condensed | Narrow, high legibility, nautical feel, wide weight range |
| Instrument values | Share Tech Mono | Fixed-width — prevents layout shift on live updates |

### Scale

- Limit to 3–4 sizes per interface.
- Instrument values: visually larger than their labels — values are what the crew reads first.
- Use `clamp()` for responsive scaling on critical values — never fixed `px` for instrument readouts.
- Helm viewing distance (arm's length, moving boat): values at minimum `clamp(2rem, 5vw, 4rem)`.
- Portal (seated, closer): values can be smaller, more information density acceptable.

---

## Night Mode Visual Rules

Night mode is toggled by `<night-toggle>` and applied via the `night` class on `<body>`. It is not a simple dark/light toggle — it is a purpose-built night vision preservation mode.

**Rules:**
- Eliminate all blue and green light — amber only.
- No white, no cyan, no green in night mode — these wavelengths degrade scotopic vision.
- Alert indicators in night mode: use amber intensity differences + icon + text (never rely on hue alone).
- State persisted in `localStorage` key `sbs-night-mode`.
- Every new component must include night mode overrides under `body.night`.
- Test night mode in a dark room — not just in browser DevTools.

---

## Component Library (`js/sbs-components.js`)

All components are native custom elements (no framework). Visual spec for each:

| Component | Usage | Visual Notes |
|-----------|-------|--------------|
| `<instrument-cell>` | Single instrument tile (label + value + unit) | Value in Share Tech Mono, large; label in Barlow Condensed, muted; surface background; min touch target 44px (80px on Helm) |
| `<wind-gauge>` | Circular wind display (TWS/TWD or AWA/AWS) | Radial SVG; amber needle; muted arc; value overlay center |
| `<depth-display>` | Depth with alarm threshold visualization | Cyan for normal; shifts to advisory/urgent color at threshold |
| `<compass-rose>` | Heading/COG compass | SVG rose; amber heading line; muted cardinal marks |
| `<alert-banner>` | Advisory/urgent alerts | Full-width; color from alert hierarchy; icon + text always |
| `<night-toggle>` | Night mode button | Amber moon icon; active state clearly distinguished |
| `<connection-status>` | SignalK connection indicator | Green dot (connected) / muted (disconnected); never uses alert colors |

**States required for every interactive component:**
- Default
- Active / pressed
- Disabled (with visible reason — never just grayed out silently)
- Night mode

---

## Files Owned / Influenced

| File | Role |
|------|------|
| `css/sbs-theme.css` | Full design system — tokens, layout, all portal components |
| `css/helm.css` | Helm-specific overrides (full-screen, large tiles, Helm night mode) |
| `js/sbs-components.js` | Custom HTML elements — visual contract (states, spacing, typography) |
| `index.html` | Portal structure — layout decisions |
| `helm.html` | Helm structure — tile grid layout |
| `crew.html` | New — design from scratch (mobile-first) |

---

## SVG Mockup Conventions

When producing mockups for new screens or components:

- Target resolution: 1024×768 (Helm tablet) or 1440×900 (Portal desktop) or 390×844 (Crew mobile).
- Use realistic sample data — not placeholder text.
- Group elements in named SVG `<g>` blocks matching component names.
- Include a token table in the mockup file header, mapping every color name to its hex value used.
- Show night mode variant alongside day variant for any Helm or cockpit component.
