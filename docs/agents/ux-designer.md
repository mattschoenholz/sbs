# Agent: UX Designer

**Project:** SailboatServer — SV-Esperanza
**Domain:** User experience, interface design, design system, HMI standards

---

## Role

Design and maintain the three-interface UX for the SailboatServer portal. Ensure all interfaces meet HMI standards for marine use: high contrast, large touch targets, night mode, glanceability under stress.

This agent focuses on *design decisions and design system* — implementation is handed off to the Frontend agent.

---

## Three Interfaces

### 1. Helm Display (`helm.html`)
- **Context:** Cockpit, mounted tablet/screen, direct sun, spray, gloved hands
- **User:** Skipper at the helm, 1–5 second glances
- **Priority:** SOG, COG, DEPTH, TWS, TWD, next waypoint bearing/distance
- **Design constraints:** Full-screen, large tiles (≥80px touch targets), no small text, night mode critical
- **Current tabs:** Instruments, Chart (pending), Passage, Weather

### 2. Skipper Portal (`index.html`)
- **Context:** Cabin, laptop/tablet, planning sessions, pre-departure
- **User:** Skipper or first mate, seated, focused
- **Priority:** Passage planning, weather analysis, boat systems control
- **Design constraints:** Information-dense, tabbed layout, full feature set
- **Current tabs:** Manage (Charts, Instruments, Weather, Passage) | Plan (Overview, Windows, Tides, Fuel, Watches) | Controls Drawer

### 3. Crew View (`crew.html`) — *Pending P2-02*
- **Context:** Phone or tablet, cockpit or below, read-only
- **User:** Crew member, not in command
- **Priority:** Current instruments, passage progress, ETA, alerts
- **Design constraints:** Mobile-first, single-scroll or minimal tabs, no controls

---

## Design System

### Tokens (`css/sbs-theme.css`)
```
--color-void:    #080c10   (page background)
--color-deep:    #0d1318   (panel background)
--color-surface: #111920   (card/tile background)
--color-amber:   #e8940a   (primary — active instruments, CTAs)
--color-cyan:    #06b6d4   (secondary — depth, chart elements)
--color-text:    #e2e8f0   (primary text)
--color-muted:   #64748b   (labels, secondary text)
```

### Typography
- **Display/Labels:** Barlow Condensed (headings, nav, instrument labels)
- **Values:** Share Tech Mono (instrument readouts — fixed-width for stability)
- Sizes: `clamp()` for responsive scaling — never fixed px for critical values

### Night Mode
- Toggled by `<night-toggle>` component
- Replaces all color with amber-only palette (eliminates blue light)
- State persisted in `localStorage`
- Critical for cockpit use — blue light kills night vision

### Component Library (`js/sbs-components.js`)
| Component | Usage |
|-----------|-------|
| `<instrument-cell>` | Single instrument tile (label + value + unit) |
| `<wind-gauge>` | Circular wind display (TWS/TWD or AWA/AWS) |
| `<depth-display>` | Depth with alarm threshold visualization |
| `<compass-rose>` | Heading/COG compass |
| `<alert-banner>` | Advisory/urgent alerts |
| `<night-toggle>` | Night mode button |
| `<connection-status>` | SignalK connection indicator |

---

## HMI Standards

- **Touch targets:** Minimum 44×44px (iOS HIG), prefer 60×80px for cockpit
- **Contrast:** WCAG AA minimum, AAA preferred for outdoor use
- **Glanceability:** Critical values must be readable in 1 second at arm's length
- **Alert hierarchy:** Urgent (red) → Advisory (orange) → Info (cyan)
- **Feedback:** Every tap has immediate visual response (active state)
- **Error states:** Always show *why* something is unavailable (not just blank)

---

## Files Owned / Influenced

| File | Role |
|------|------|
| `css/sbs-theme.css` | Full design system — tokens, layout, all portal components |
| `css/helm.css` | Helm-specific overrides |
| `js/sbs-components.js` | Custom HTML elements — design contracts |
| `index.html` | Portal structure, tab layout |
| `helm.html` | Helm structure, tile grid |
| `crew.html` | New — design from scratch |

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Mar 2026 | Amber primary color | Low blue, high visibility, nautical feel |
| Mar 2026 | Share Tech Mono for values | Fixed-width prevents layout shift on updates |
| Mar 2026 | Helm → full redirect (not tab) | Distinct cockpit context, no confusion with portal |
| Mar 2026 | Controls Drawer (global) | Accessible from any tab without leaving current context |
| Mar 2026 | Three separate interfaces | Helm/Skipper/Crew have distinct contexts, needs, permissions |
