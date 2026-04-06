# SV-Esperanza Alert System -- Design Specification

**Version:** 1.1  
**Date:** 2026-04-05  
**Status:** Design complete, ready for implementation  
**Scope:** Portal (`index.html`) and Helm (`helm.html`)

---

## 1. System Overview

The alert system has three visual layers that work together:

| Layer | Purpose | Visibility | User action |
|-------|---------|------------|-------------|
| **Status Strip** | Persistent bottom bar showing info or alerts | Always visible on every tab | Tap to cycle/dismiss |
| **Tile State** | Visual change on the instrument tile that owns the alert | Visible on Instruments tab | Tile itself is not a dismiss target |
| **Critical Modal** | Full-screen takeover for life-safety events | Blocks all interaction until acknowledged | Mandatory acknowledge button |

**Precedence:** Critical modal overrides everything. Strip and tile state are independent and additive -- both activate when an alert fires.

---

## 2. The Status Strip

### 2.1 Position and Dimensions

- **Position:** Fixed to the bottom of the viewport, full width
- **Height:** `36px` (provides a 36x(full-width) touch target -- well above 48px on the long axis)
- **Z-index:** `800` (below the MOB button at `z-index: 800` on Helm -- see note below, and below critical modal at `900`)
- On Helm: the MOB button is currently `position: fixed; bottom: 16px; left: 16px`. The strip must sit *behind* the MOB button. The MOB button's z-index should be raised to `850` to guarantee it floats above the strip.

### 2.2 Layout

```
+----------------------------------------------------------------------+
|  [icon]  [message text]                          [timestamp]  [x/n]  |
+----------------------------------------------------------------------+
```

- **Left icon area:** 20x20px icon (MDI-style or Unicode glyph), left-padded `var(--sp-md)` (12px)
- **Message text:** Flex-grow, left-aligned, single line, truncated with ellipsis if too long
- **Timestamp:** Right-aligned, shows time of alert (e.g., `14:23`) or info age
- **Page indicator:** When multiple alerts are queued, shows `1/3` style indicator. Tap anywhere on the strip to advance to the next message. Only visible when count > 1.

### 2.3 Content Modes

The strip is always occupied. It has three visual modes determined by the highest-priority content it is displaying.

#### Mode A: Informational (no alerts active)

Shows rotating general navigation/status information. This is the calm baseline.

**Background:** `var(--c-deep)` (`#0d1318`)  
**Border-top:** `1px solid var(--c-border)` (`#1e2e3a`)  
**Text color:** `var(--t-secondary)` (`#8fa3b3`)  
**Icon color:** `var(--t-muted)` (`#4a6070`)

Content rotates on a 5-second interval (no animation, instant swap). Tap advances manually. Examples of informational content:

| Content | Format | Icon | Source |
|---------|--------|------|--------|
| Current heading | `HDG 247 T` | Compass glyph | `SBSData.hdg` |
| Position | `47 37.2'N  122 20.1'W` | Pin glyph | `SBSData.position` |
| Battery state | `BATT 12.8V  SOC 92%` | Battery glyph | ESP32 solar data |
| Next waypoint | `NXT WP: Cape Flattery  12.4nm  BRG 285` | Arrow glyph | Passage state |
| Watch info | `ON WATCH: Matt  ends 02:00` | Clock glyph | Passage watch schedule |
| Barometer trend | `BARO 1018 hPa  RISING +2.1` | Trend arrow | `SBSData.pressure` |

The developer should implement this as an array of provider functions. Each provider returns `null` if it has nothing to show (e.g., "next waypoint" returns `null` if no passage is active). The strip cycles through non-null providers. New providers can be added to the array without touching other code.

**Typography:**  
- Message text: `font-family: var(--font-mono)` / `font-size: var(--s-sm)` / `letter-spacing: 0.06em`
- All uppercase, matching the instrument aesthetic

#### Mode B: Advisory (yellow alerts active)

One or more advisory-level alerts are in the queue.

**Background:** `var(--c-yellow-dim)` (`#713f12`)  
**Border-top:** `2px solid var(--c-yellow)` (`#eab308`)  
**Text color:** `var(--c-yellow)` (`#eab308`)  
**Icon color:** `var(--c-yellow)`

The strip displays the advisory message. If multiple advisories exist, the page indicator shows count and tap cycles through them. Informational content is suppressed while any advisory is active.

**Typography:**  
- Message text: `font-family: var(--font-display)` / `font-size: var(--s-md)` / `font-weight: 600` / `letter-spacing: 0.06em`
- Slightly larger and bolder than informational mode to signal elevated importance

**Dismiss behavior:** See Section 2.5.

#### Mode C: Urgent (red alerts active, but not critical-tier)

One or more urgent-level alerts are active. These are serious but not life-safety.

**Background:** `var(--c-red-dim)` (`#7f1d1d`)  
**Border-top:** `2px solid var(--c-red)` (`#ef4444`)  
**Text color:** `var(--c-red)` (`#ef4444`)  
**Icon color:** `var(--c-red)`  
**Box-shadow:** `var(--shadow-red)` (red glow, draws the eye)

**Typography:** Same as advisory mode but in red palette.

**Entry animation:** Strip pulses opacity twice on arrival (0.3s ease, 100% -> 70% -> 100% -> 70% -> 100%), then holds steady. No continuous pulsing -- that would desensitize the operator.

**Dismiss behavior:** See Section 2.5.

### 2.4 Priority and Queuing

When alerts of mixed severity are active simultaneously:

1. The strip displays the **highest-severity** alert first.
2. If multiple alerts share the same severity, they display in **chronological order** (oldest first -- the user needs to see what they may have missed).
3. The page indicator (e.g., `2/4`) reflects the total number of active alerts across all severities.
4. Tapping the strip cycles to the next alert. After the last alert, it wraps to the first.
5. If all alerts are dismissed, the strip returns to informational mode immediately with no transition animation.

### 2.5 Dismiss Behavior

#### Portal

- **Advisory:** Dismiss button (X) on the right side of the strip. Tapping it removes that advisory from the queue. If the condition re-fires (e.g., SOG drops again), a new alert is created.
- **Urgent:** No dismiss button. The alert clears only when the condition clears (e.g., depth returns above threshold). This prevents the operator from dismissing a hazard that is still present.
- **Informational:** No dismiss -- it rotates perpetually.

#### Helm

- **Advisory:** Same X dismiss as Portal.
- **Urgent:** Same as Portal -- no manual dismiss; condition-driven.
- **Additional Helm behavior:** When any alert is active (advisory or urgent), a small colored dot appears on the relevant tab button if the user is not on the Instruments tab. This uses the existing `.badge` class on `.helm-tab`. Color matches alert severity (yellow dot for advisory, red dot for urgent).

### 2.6 Interaction with Existing Layout

The strip sits at the very bottom. Content areas need `padding-bottom: 36px` (or equivalent) to avoid being occluded.

- **Portal:** The `.sbs-panel` elements get `padding-bottom: 36px` added.
- **Helm:** The `.helm-panel` flex children need `margin-bottom: 36px` or the strip needs to be part of the flex column (preferred -- add it as the last child of `.helm-app` so flex layout accounts for it naturally).

The existing `<alert-banner>` component at the top of both UIs is **replaced** by the strip. Remove the `<alert-banner>` element from both HTML files and its CSS/JS. The event names `alert:urgent` and `alert:advisory` in `SBSData` remain -- the new strip component listens to them instead.

### 2.7 Night Mode (Red Monochromatic)

Night mode uses a **fully red-monochromatic palette** to preserve scotopic (dark-adapted) vision. No amber, white, blue-grey, or any non-red hue appears anywhere on screen. Only the red channel carries information; green and blue channels are zero across the entire UI.

**Design principle:** Differentiation between normal, advisory, and urgent states is achieved purely through **brightness and saturation** within the red channel, not through hue changes (which are unavailable in a monochromatic palette).

The following night mode tokens override the day palette when `:root.night` is active:

#### Global night tokens

| Token | Night value | Day equivalent | Purpose |
|-------|-------------|----------------|---------|
| `--c-void` | `#0a0000` | `#080c10` | Page background (near-black red) |
| `--c-deep` | `#0d0202` | `#0d1318` | Top bar, tab bar, strip info background |
| `--c-surface` | `#110505` | `#111920` | Tile/card fill |
| `--c-border` | `#2a0a0a` | `#1e2e3a` | Normal tile borders, divider lines |
| `--t-primary` | `#ff3333` | `#f0f4f8` | Instrument values (brightest readable red) |
| `--t-secondary` | `#882222` | `#8fa3b3` | Info strip text, timestamps |
| `--t-muted` | `#551a1a` | `#4a6070` | Labels (SOG, COG, DEPTH, etc.) |
| `--t-unit` | `#662222` | `#8fa3b3` | Unit text (KN, DEG T, M) |
| `--c-accent` | `#ff3333` | `#f5a820` | Active tab text, HELM title |
| `--c-accent-dim` | `#cc2222` | `#e8940a` | Active tab indicator bar |
| `--c-inactive` | `#3a1010` | `#4a6070` | Inactive tab text |
| `--c-green` | `#882222` | `#22c55e` | AP standby button (green mapped to mid-red) |
| `--c-cyan` | `#ff3333` | `#06b6d4` | STW value (cyan mapped to primary red) |
| `--c-connection` | `#ff3333` | `#22c55e` | Connection status dot |
| `--c-btn-bg` | `#140606` | `#16222d` | Button background |
| `--c-btn-border` | `#3a1212` | `#2a3f50` | Button border |
| `--c-btn-text` | `#bb3333` | `#e8edf2` | Button text |

#### Strip night tokens

| Strip mode | Background | Border | Text | Icon |
|------------|-----------|--------|------|------|
| **Info** | `#0d0202` | `1px #2a0a0a` | `#882222` | `#441111` |
| **Advisory** | `#220808` | `2px #aa2020` | `#cc2222` | `#cc2222` |
| **Urgent** | `#3a0808` | `2px #ff3333` | `#ff3333` | `#ff3333` |

**Brightness ladder for severity differentiation (red channel only):**
- **Normal/info state:** darkest reds. Strip text `#882222` (R=136), tile borders `#2a0a0a` (R=42). Calm, recessive baseline.
- **Advisory state:** mid-brightness reds. Strip text `#cc2222` (R=204), tile border `#aa2020` (R=170). Clearly elevated above normal but not the brightest.
- **Urgent state:** maximum brightness reds. Strip text `#ff3333` (R=255), tile border `#ff3333` (R=255), plus red glow filter. Unmistakable even in peripheral vision.

The jump from info (R=136) to advisory (R=204) to urgent (R=255) provides a clear 3-step intensity ramp. Advisory also uses a brighter strip background (`#220808` vs `#0d0202`) and a 2px border (vs 1px for info), adding structural differentiation beyond just color brightness.

#### Tile state in night mode

| Tile state | Border | Value color | Glow |
|------------|--------|-------------|------|
| Normal | `#2a0a0a` (1px) | `#ff3333` | None |
| Advisory | `#aa2020` (2px) | `#ff3333` (unchanged) | None |
| Urgent | `#ff3333` (2px) | `#ff3333` | `feDropShadow` red glow, `flood-color="#ff3333"`, `opacity="0.2"` |

In normal state, all instrument values are already `#ff3333`. For advisory, only the border intensifies (the value was already bright). For urgent, the border goes to full intensity *and* a glow filter is added -- the glow is the primary night-mode differentiator for urgent tiles since the value color cannot get brighter.

#### MOB button in night mode

The MOB button retains full-intensity red (`#ff2222` fill, `#ff4444` stroke) in night mode. Its text and icon switch from white to `#0a0000` (near-black on bright red) to eliminate non-red light emission. The MOB button is a safety control and must remain instantly recognizable regardless of mode.

#### Night mode indicator

A solid `#ff3333` dot (4px radius) appears in the annotation bar or top bar to confirm night mode is active. This is the only persistent indicator; no text label is needed once the user sees the all-red palette.

See mockups: `docs/design/mockups/night-mode-info.svg` (dark cockpit baseline) and `docs/design/mockups/night-mode-urgent.svg` (urgent alert state).

---

## 3. Tile State Changes

When an alert fires, the instrument tile associated with that data source changes its visual state. This provides spatial context -- the user sees *which* instrument is in alarm without reading the strip text.

### 3.1 Which Tiles Change for Which Alerts

| Alert condition | Portal tile ID | Helm tile ID | State class |
|----------------|---------------|-------------|-------------|
| Shallow water (depth < 3m) | `itile-depth` | `tile-depth` | `.alert-advisory` |
| Critical depth (depth < 1m) | `itile-depth` | `tile-depth` | `.alert-urgent` |
| Bilge water detected | `itile-bilge` | *(none on Helm instruments -- strip only)* | `.alert-urgent` |
| High wind (TWS > threshold) | `itile-tws` | `tile-tws` | `.alert-advisory` |
| Battery low (V < threshold) | *(Solar card, not a tile)* | *(strip only)* | `.alert-urgent` |
| Anchor drag | *(strip + modal)* | *(strip + modal)* | N/A (goes to critical modal) |
| Autopilot off-course | *(none)* | `tile-ap` | `.alert-advisory` |

This table is illustrative. The developer should implement tile state as a **mapping object** (alert ID -> tile element ID + state class) so new entries can be added in one place.

### 3.2 Visual Treatment

Two state classes, matching strip severity:

#### `.alert-advisory` (on a tile)

```css
.helm-tile.alert-advisory,
.inst-tile.alert-advisory {
  border-color: var(--c-yellow);
  box-shadow: 0 0 0 1px var(--c-yellow) inset;
}
```

No background change, no value color change. The border is the only indicator -- subtle but visible. The existing shallow/critical depth classes (`.shallow`, `.critical`) already do something similar; those should be **aliased to** or **replaced by** `.alert-advisory` and `.alert-urgent` for consistency.

#### `.alert-urgent` (on a tile)

```css
.helm-tile.alert-urgent,
.inst-tile.alert-urgent {
  border-color: var(--c-red);
  box-shadow: var(--shadow-red);
}
.helm-tile.alert-urgent .h-value,
.inst-tile.alert-urgent .it-value {
  color: var(--c-red) !important;
}
```

The value itself turns red, and the tile gets the red glow. This is the same treatment the existing `.critical` and `.bilge-wet` classes use -- unify them under `.alert-urgent`.

#### No pulse animation on tiles

Continuous pulsing animation on tiles is rejected. Reason: on a 6-tile Instruments grid, a pulsing tile creates peripheral flicker that degrades readability of adjacent tiles. The border color change + value color change is sufficient. The strip's entry pulse handles the "something just changed" signal.

### 3.3 Tile State Lifecycle

- Tile state is applied when the alert fires and removed when the condition clears.
- Tile state is independent of strip dismiss -- you cannot dismiss a tile's visual state. It tracks the live data.
- If the user is on a different tab (e.g., Chart tab on Helm), the tile state is still applied so it is correct when they switch back.

### 3.4 Relationship to Strip

Tile state and strip state are driven by the **same alert event** but are visually independent:
- An advisory alert fires -> strip enters Mode B *and* the owning tile gets `.alert-advisory`
- The strip may cycle to show other alerts, but the tile stays in alert state as long as the condition persists
- When the condition clears, both the strip entry and the tile class are removed

---

## 4. Critical Modal

Reserved exclusively for confirmed life-safety events. The current system has exactly two candidates:

1. **Bilge water confirmed** -- bilge sensor reads wet for >30 seconds continuously (debounced to avoid false alarms from wave slosh)
2. **Anchor drag confirmed** -- GPS position drifts beyond anchor watch radius while anchor watch is active

The MOB overlay is a separate system and remains unchanged. The critical modal is for *automated* detections, not user-initiated actions.

### 4.1 Trigger Criteria

A critical modal fires only when:
- The underlying data source confirms the condition (not a single transient reading)
- A debounce period has elapsed (defined per alarm source, minimum 10 seconds)
- The modal is not already showing for this same alarm ID (no stacking)

If a second, different critical alarm fires while one modal is showing, it queues behind. After the first is acknowledged, the second appears immediately.

### 4.2 Layout

```
+======================================================================+
|                                                                      |
|                                                                      |
|                     [ALARM ICON -- large, 64px]                      |
|                                                                      |
|                     BILGE WATER DETECTED                             |
|                     (headline, 2 lines max)                          |
|                                                                      |
|               Bilge sensor has been wet for 45 seconds.              |
|                  Check bilge pump and through-hulls.                  |
|                     (instruction text, 3 lines max)                  |
|                                                                      |
|                          14:23:07 UTC                                |
|                         (timestamp)                                  |
|                                                                      |
|                                                                      |
|              +------------------------------------+                  |
|              |         ACKNOWLEDGE ALARM          |                  |
|              +------------------------------------+                  |
|                                                                      |
|                                                                      |
+======================================================================+
```

### 4.3 Visual Specification

**Overlay background:** `rgba(100, 0, 0, 0.95)` -- same deep red as the existing MOB overlay. Matches the established "something is very wrong" visual language.

**Alarm icon:**  
- 64x64px area, centered  
- Unicode or MDI glyph appropriate to alarm type  
- Color: `#ffffff`  
- For bilge: water/droplet icon  
- For anchor drag: anchor icon  

**Headline:**  
- `font-family: var(--font-display)`
- `font-size: clamp(24px, 6vw, 40px)`
- `font-weight: 700`
- `letter-spacing: 0.08em`
- `text-transform: uppercase`
- `color: #ffffff`
- `text-align: center`
- Maximum 2 lines. If it wraps, that is acceptable.

**Instruction text:**  
- `font-family: var(--font-body)`
- `font-size: clamp(14px, 3vw, 18px)`
- `font-weight: 400`
- `color: #ffaaaa` (same as MOB coordinate text)
- `text-align: center`
- `max-width: 400px` centered
- Tells the operator what to do. Must be actionable (ISA-18.2).

**Timestamp:**  
- `font-family: var(--font-mono)`
- `font-size: var(--s-sm)`
- `color: rgba(255, 255, 255, 0.5)`
- Shows when the alarm condition was first detected (not when the modal appeared)

**Acknowledge button:**  
- Width: `min(80%, 360px)`, centered
- Height: `56px` minimum (large touch target)
- `background: rgba(255, 255, 255, 0.15)`
- `border: 2px solid rgba(255, 255, 255, 0.6)`
- `border-radius: var(--r-md)` (8px)
- `color: #ffffff`
- `font-family: var(--font-display)`
- `font-size: clamp(14px, 3vw, 18px)`
- `font-weight: 700`
- `letter-spacing: 0.1em`
- `text-transform: uppercase`
- Label: `ACKNOWLEDGE ALARM`

### 4.4 Accidental Touch Protection

The acknowledge button is **disabled for the first 3 seconds** after the modal appears. During this delay:

- The button has `opacity: 0.3` and `pointer-events: none`
- A subtle countdown text appears below the button: `(hold 3s)` -- this indicates the delay, not that the user must hold the button. After 3 seconds, the countdown text disappears and the button becomes fully interactive.
- This prevents a user who was mid-tap on something else from accidentally dismissing a critical alarm.

After the delay, a single tap acknowledges. No press-and-hold required -- the 3-second delay is sufficient protection, and press-and-hold is unreliable on marine touchscreens (vibration, wet fingers).

### 4.5 Post-Acknowledge Behavior

- The modal dismisses immediately.
- The underlying condition may still be active. If so, the **strip** continues to show the urgent alert (Mode C) and the **tile** retains `.alert-urgent`. The critical modal does not re-fire for the same alarm ID until the condition clears and re-triggers.
- The alarm event is logged with timestamp, alarm ID, and acknowledge timestamp (for the developer to implement in `SBSData` state).

### 4.6 Night Mode (Red Monochromatic)

The critical modal overlay background (`rgba(100, 0, 0, 0.95)`) is already purely red and needs no night mode adjustment. This is intentional -- the deep red overlay is correct for both day and night.

In night mode, text colors within the modal shift from white/pink to **red-monochromatic** equivalents to eliminate non-red light:

| Element | Day color | Night color | Rationale |
|---------|-----------|-------------|-----------|
| Alarm icon | `#ffffff` | `#ff4444` | Brightest red replaces white |
| Headline | `#ffffff` | `#ff4444` | Maximum red brightness for headline readability |
| Instruction text | `#ffaaaa` | `#cc4444` | Mid-red, clearly subordinate to headline |
| Timestamp | `rgba(255,255,255,0.5)` | `#882222` | Dim red, recessive |
| Button text | `#ffffff` | `#ff4444` | Must be readable at arm's length |
| Button border | `rgba(255,255,255,0.6)` | `rgba(255,68,68,0.6)` | Red border on dark red background |
| Button background | `rgba(255,255,255,0.15)` | `rgba(255,68,68,0.15)` | Subtle red fill |

The modal remains maximally attention-getting in night mode. The `#ff4444` headline on a `rgba(100,0,0,0.95)` background provides strong contrast while emitting only red light. At 0300, this is preferable to pure white which would destroy dark adaptation.

---

## 5. Alert Priority Taxonomy

Three tiers. The developer assigns each new alarm source to exactly one tier using the criteria below.

### Tier 1: Critical

**Strip mode:** N/A (goes directly to modal; strip shows urgent-red after modal is acknowledged if condition persists)  
**Tile state:** `.alert-urgent`  
**Visual:** Full-screen modal overlay

**Criteria -- ALL must be true:**
1. The condition poses a risk to vessel safety, structural integrity, or crew safety
2. The operator must act within minutes, not hours
3. The alarm is debounced/confirmed (not a transient spike)
4. There is a specific, immediate action the operator can take

**Current sources:**
- Bilge water confirmed (wet >30s)
- Anchor drag confirmed (position outside watch radius, sustained >60s)

**Future candidates (examples for extensibility):**
- Smoke/CO detection
- Catastrophic battery voltage (<10.5V sustained)
- Through-hull flooding sensor

### Tier 2: Advisory

**Strip mode:** Mode B (yellow)  
**Tile state:** `.alert-advisory`  
**Visual:** Yellow strip + yellow tile border

**Criteria -- ANY is sufficient:**
1. A measured value is outside its normal operating range but not immediately dangerous
2. A planned parameter is drifting (ETA slip, SOG below plan)
3. A system needs attention soon but not immediately
4. Environmental conditions are changing in a concerning direction

**Current sources:**
- Shallow water (depth < 3m but >= 1m)
- SOG below plan threshold
- ETA slippage > 30 minutes
- Barometric pressure dropping rapidly (> 3 hPa/3hr)
- Wind speed exceeding planned conditions
- AIS target on collision course (CPA < threshold)
- Autopilot heading error exceeding tolerance

**Future candidates:**
- Battery SOC below 30%
- Water tank low
- Engine temperature elevated but not critical

### Tier 3: Informational

**Strip mode:** Mode A (muted, rotating)  
**Tile state:** None -- no tile visual change  
**Visual:** Appears as one entry in the informational rotation

**Criteria:**
1. The user should be aware but no action is needed now
2. System status that provides context but is not time-sensitive

**Current sources:**
- Current heading, position, battery state (always-on rotation)
- Next waypoint details (when passage active)
- Watch schedule info

**Future candidates:**
- Firmware update available
- WiFi signal weak
- Tide approaching (informational, not advisory)

### Decision Flowchart for New Alarm Sources

```
Is there immediate risk to vessel/crew safety?
  YES --> Is it debounced/confirmed?
    YES --> CRITICAL (Tier 1)
    NO  --> Add debounce logic, then CRITICAL
  NO  --> Does the operator need to act within the current watch?
    YES --> ADVISORY (Tier 2)
    NO  --> INFORMATIONAL (Tier 3)
```

---

## 6. Helm vs. Portal Differences

| Behavior | Portal | Helm |
|----------|--------|------|
| Strip position | Bottom of viewport | Bottom of viewport |
| Strip info rotation | Shows all providers | Shows nav-focused subset (HDG, NXT WP, battery) -- omit providers irrelevant to helmsman |
| Advisory dismiss | X button | X button |
| Urgent dismiss | Condition-driven only | Condition-driven only |
| Tab badge | Not applicable (no tab bar alerts) | Red/yellow dot on Instruments tab and Passage tab when alerts are active and user is on a different tab |
| Tile state | On Portal Instruments tab tiles | On Helm Instruments tab tiles |
| Critical modal | Identical | Identical |
| MOB button overlap | No MOB button on Portal | MOB button z-index raised to 850; strip renders behind it. Strip content left-pads 80px on Helm to avoid text hiding behind MOB button |
| Info strip: passage data | Shows if passage active | Always shows if passage active (helmsman needs this more) |

### Helm-Specific: Strip Left Padding

On Helm, the MOB button occupies the bottom-left corner (roughly 72x72px circle at `bottom: 16px; left: 16px`). The strip must not place content behind it. Solution: on Helm, the strip's inner content area gets `padding-left: 80px`. The strip background still extends full width, but text and icons start after the MOB button.

---

## 7. CSS Token Summary

New tokens to add to `:root` in `sbs-theme.css`:

```
--strip-h:          36px;
--strip-bg-info:    var(--c-deep);
--strip-bg-adv:     var(--c-yellow-dim);
--strip-bg-urg:     var(--c-red-dim);
--strip-border-adv: var(--c-yellow);
--strip-border-urg: var(--c-red);
```

### Night mode overrides (`:root.night`)

Night mode requires a comprehensive set of overrides to achieve red monochromaticism. These go in the existing `:root.night { }` block in `sbs-theme.css`:

```css
:root.night {
  /* Backgrounds */
  --c-void:       #0a0000;
  --c-deep:       #0d0202;
  --c-surface:    #110505;
  --c-border:     #2a0a0a;

  /* Text hierarchy */
  --t-primary:    #ff3333;
  --t-secondary:  #882222;
  --t-muted:      #551a1a;

  /* Accent / UI chrome */
  --c-accent:     #ff3333;
  --c-accent-dim: #cc2222;
  --c-inactive:   #3a1010;

  /* Semantic colors -> red equivalents */
  --c-green:      #882222;  /* AP standby, connection OK */
  --c-cyan:       #ff3333;  /* STW (mapped to primary) */
  --c-yellow:     #cc2222;  /* Advisory -> mid-red */
  --c-yellow-dim: #220808;  /* Advisory strip bg */
  --c-red:        #ff3333;  /* Urgent (already red, maximize brightness) */
  --c-red-dim:    #3a0808;  /* Urgent strip bg */
  --c-connection: #ff3333;

  /* Buttons */
  --c-btn-bg:     #140606;
  --c-btn-border: #3a1212;
  --c-btn-text:   #bb3333;

  /* Strip-specific */
  --strip-bg-info:    #0d0202;
  --strip-bg-adv:     #220808;
  --strip-bg-urg:     #3a0808;
  --strip-border-adv: #aa2020;
  --strip-border-urg: #ff3333;

  /* Critical modal text overrides */
  --modal-headline:     #ff4444;
  --modal-instruction:  #cc4444;
  --modal-timestamp:    #882222;
  --modal-btn-text:     #ff4444;
  --modal-btn-border:   rgba(255, 68, 68, 0.6);
  --modal-btn-bg:       rgba(255, 68, 68, 0.15);
}
```

**Important:** The night overrides for `--c-yellow` and `--c-red` remap advisory and urgent to different brightness levels *within the red channel*. Day mode uses hue (yellow vs red) to distinguish severity. Night mode uses brightness (R=204 `#cc2222` vs R=255 `#ff3333`). The CSS variable indirection means all existing advisory/urgent styles automatically adapt -- no separate night-mode classes are needed on the strip or tiles.

---

## 8. Component Architecture

The new system replaces `<alert-banner>` with a single new web component: `<status-strip>`.

**Element name:** `<status-strip>`  
**Placement:** Last child of `.sbs-app` (Portal) and `.helm-app` (Helm)  
**Attribute:** `context="portal"` or `context="helm"` -- controls info provider subset and MOB padding

The component:
1. Listens to `SBSData.on('update', ...)` for informational rotation
2. Listens to `SBSData.on('alert:urgent', ...)` and `SBSData.on('alert:advisory', ...)` for alert display
3. Manages its own alert queue (array of `{id, level, message, time}`)
4. Exposes `clearAlert(id)` for condition-driven removal

A separate component or function handles the critical modal: `showCriticalModal({icon, headline, instruction, timestamp, alarmId})`. This can be a standalone function rather than a web component since it creates and destroys a full-screen overlay element.

### New SBSData Events

Add a third event tier:

- `alert:critical` -- triggers the modal. Payload: `{id, message, instruction, icon, time}`
- Existing `alert:urgent` and `alert:advisory` remain, now feed the strip instead of the old banner

Add a clearing event:

- `alert:clear` -- payload: `{id}`. Removes the alert from the strip queue and clears the tile state class. Fired when the underlying condition returns to normal.

---

## 9. Migration Checklist

For the developer implementing this spec:

1. Remove `<alert-banner>` from `index.html` and `helm.html`
2. Remove `.alert-banner` CSS block from `sbs-theme.css`
3. Remove the `alert-banner` class from `sbs-components.js`
4. Add `<status-strip context="portal">` to `index.html` (last child of `.sbs-app`)
5. Add `<status-strip context="helm">` to `helm.html` (last child of `.helm-app`)
6. Add strip CSS to `sbs-theme.css` (shared) and Helm-specific overrides to `helm.css`
7. Unify `.shallow`/`.critical`/`.bilge-wet` tile classes into `.alert-advisory`/`.alert-urgent`
8. Update depth and bilge logic in `portal.js` and `helm.js` to use new class names
9. Add `alert:critical` event to `SBSData` and `alert:clear` event
10. Add critical modal function to `sbs-components.js`
11. Raise MOB button z-index to `850` in `helm.css`
12. Add `padding-bottom: var(--strip-h)` to Portal panels and account for strip in Helm flex layout
13. Update bilge alert to fire `alert:critical` (with 30s debounce) instead of `alert:urgent`
14. Add `:root.night` overrides block with red-monochromatic token values (Section 7)
15. Update critical modal to use `var(--modal-headline)` etc. instead of hardcoded `#ffffff`, falling back to `#ffffff` when the variable is not set (day mode)
