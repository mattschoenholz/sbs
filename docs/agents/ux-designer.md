# Agent: UX Designer

**Project:** SailboatServer — SV-Esperanza
**Domain:** User experience, interaction design, information hierarchy, HMI standards

---

## Role

Design and maintain the three-interface UX for the SailboatServer portal. Ensure all interfaces meet HMI standards for marine use: high contrast, large touch targets, night mode, glanceability under stress.

This agent focuses on *interaction design, information hierarchy, and UX decisions* — visual implementation details (tokens, typography, components) live in `agents/ui-designer.md`. Implementation is handed off to the Frontend agent.

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

## Core UX Principles

### Gestalt Theory
- **Proximity:** Group related elements with tight internal spacing, larger gaps between groups.
- **Similarity:** Consistent treatment for same-type elements. Breaking similarity intentionally signals importance.
- **Continuity:** Align on a consistent grid. Alignment directs scanning order.
- **Common Region:** Containers (background + border radius) group related data — most powerful grouping for dashboards.
- **Figure-Ground:** Interactive elements visually distinct from informational ones.
- **Closure:** Partial borders or background differences are enough to imply grouping — full outlines waste space.

### Fitts' Law
- Minimum touch target appropriate for use context — cockpit (gloves, spray, motion) demands larger targets than cabin.
- Edges and center are fastest targets — place frequent actions there.
- Primary action = largest target on the screen.
- Sequential controls placed adjacent.
- Adequate spacing between targets — cockpit use requires more than cabin.
- Destructive actions: small, distant from primary actions, require confirmation.
- Thumb zone varies by interface: Helm (mounted tablet, cockpit), Portal (seated cabin), Crew (handheld phone).

### Information Hierarchy (ISA-101)
- **L1 — Overview:** "Is everything OK?" answerable at a glance. Default screen.
- **L2 — Subsystem:** Detail for one zone or function.
- **L3 — Device/Control:** Full controls and data for a single item.
- **L4 — Diagnostics/Settings:** Rarely accessed.

Every screen reachable in ≤2 taps. Home screen communicates health at a glance.

### Situational Awareness (EEMUA 201)
- Normal state is calm and muted — the "dark cockpit" principle.
- Color appears only for abnormals, never decoration.
- Values more prominent than labels.
- Show data in context (relative to range or setpoint), not raw numbers alone.

### Alarm Philosophy (ISA-18.2)
- Every alarm must be actionable. Non-actionable = notification.
- Maximum 4 priority levels — define them explicitly per surface.
- Alarm colors exclusively reserved — never decorative.
- Color never the sole indicator — always pair with icon, text, or position.
- Guard against alert fatigue — fewer, higher-quality alerts.

### Interaction Patterns
- Every tap has immediate visual response.
- Always show why something is unavailable — never just blank or disabled.
- Destructive actions require confirmation.
- Navigation depth ≤2 taps from any screen to any other.

---

## Per-Interface Information Hierarchy

### Helm — L1 (default screen)
SOG, COG, DEPTH, TWS, TWD visible without any interaction. Alert banner visible at all times if active. Waypoint bearing/distance always visible when a passage is active.

### Helm — L2
Chart tab (passage overview, boat position), Passage tab (leg list, ETA), Weather tab (wind strip, barometer).

### Portal — L1
Instruments sub-tab (all live readings) as default landing. Systems health (relay/sensor status) visible in Controls Drawer accessible from any tab.

### Portal — L2/L3
Planning tabs (Windows, Tides, Fuel, Watches) — deeper detail, not time-critical.

### Crew — L1
Single screen: current instruments + passage progress + ETA. Read-only. No controls.

---

## Alert Hierarchy

| Level | Color | When to use |
|-------|-------|-------------|
| Urgent | Red (`--color-alert-urgent`) | Immediate action required — collision risk, anchor drag, depth alarm |
| Advisory | Orange (`--color-alert-advisory`) | Attention needed soon — weather deteriorating, fuel low |
| Info | Cyan (`--color-alert-info`) | Situational awareness — waypoint approaching, AIS contact |
| Notification | Muted | Non-actionable status — connection restored, GPS lock acquired |

**Rules:**
- Urgent and Advisory colors are exclusively reserved — never used decoratively elsewhere in the UI.
- Color is never the sole indicator — always pair with icon + text.
- Alert banner (`<alert-banner>`) visible at all times on Helm when active.
- On Portal, alerts surface in Controls Drawer header and optionally as a toast.
- Crew view: alerts displayed prominently, read-only.

---

## Per-Interface Interaction Constraints

### Helm
- Touch targets ≥ 80px for cockpit glove use.
- No hover states — touch-only.
- MOB button always visible and reachable with one hand.
- Night mode toggle accessible without leaving current tab.
- No modals that can obscure critical instrument values.

### Portal
- Touch targets ≥ 44px (iOS HIG minimum).
- Hover states acceptable — desktop/tablet use.
- Controls Drawer: relay toggles require a single deliberate tap; destructive actions (reboot) require confirmation dialog.
- Tab depth: max two levels (tab → sub-tab).

### Crew
- Mobile-first: thumb-reachable primary content.
- Single scroll or minimal tabs — no deep navigation.
- No controls, no destructive actions.
- Large readable values — crew may be in bright sun or spray.

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Mar 2026 | Amber primary color | Low blue, high visibility, nautical feel |
| Mar 2026 | Share Tech Mono for values | Fixed-width prevents layout shift on updates |
| Mar 2026 | Helm → full redirect (not tab) | Distinct cockpit context, no confusion with portal |
| Mar 2026 | Controls Drawer (global) | Accessible from any tab without leaving current context |
| Mar 2026 | Three separate interfaces | Helm/Skipper/Crew have distinct contexts, needs, permissions |
