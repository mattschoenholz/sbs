# Agent: Data & Instruments

**Project:** SailboatServer — SV-Esperanza
**Domain:** sbs-data.js, SignalK WebSocket client, data normalization, passage tracking, alerts

---

## Role

Own the data layer between SignalK and the UI. Maintain `sbs-data.js` — the singleton that manages the SignalK WebSocket connection, normalizes instrument data, tracks passage state, and emits alerts.

---

## sbs-data.js — SBSData Singleton

### Connection
```javascript
SBSData.connect(host, port)   // initiates WS to ws://{host}:{port}/signalk/v1/stream
SBSData.disconnect()
SBSData.onConnect(cb)
SBSData.onDisconnect(cb)
```

Default host: `sailboatserver.local`, fallback `192.168.42.201`.

### Data Access
```javascript
SBSData.get(path)             // current value for any SignalK path
SBSData.subscribe(path, cb)   // callback on any update to path
SBSData.getVessels()          // AIS: map of MMSI → vessel data
```

### Unit Normalization
SignalK delivers raw SI units. `sbs-data.js` normalizes on read:

| SignalK Path | Raw Unit | Normalized |
|---|---|---|
| `navigation.speedOverGround` | m/s | knots |
| `navigation.courseOverGroundTrue` | rad | degrees |
| `navigation.headingTrue` | rad | degrees |
| `navigation.speedThroughWater` | m/s | knots |
| `environment.depth.belowTransducer` | m | meters (displayed as-is) |
| `environment.wind.speedTrue` | m/s | knots |
| `environment.wind.angleTrue` | rad | degrees |
| `environment.wind.speedApparent` | m/s | knots |
| `environment.wind.angleApparent` | rad | degrees (+/- from bow) |
| `environment.outside.pressure` | Pa | hPa (÷1000) |
| `environment.outside.temperature` | K | °C (−273.15) |
| `environment.outside.humidity` | 0–1 | % (×100) |

### Passage Integration
```javascript
SBSData.setPassage(passage)   // set active passage plan (from portal.js)
SBSData.getPassage()          // current passage
SBSData.getPassageStatus()    // { activeLeg, distToNext, etaNext, etaDest, ... }
```

Passage data model (see `AGENT_HANDOFF.md`):
```javascript
{
  from, to,
  waypoints: [{ name, lat, lon }],
  planSOG, departureTime, selectedWindow, crew
}
```
Persisted to `localStorage` key `sbs-passage`.

### Alert System
```javascript
SBSData.addAlert({ type, message, level })   // level: 'info'|'advisory'|'urgent'
SBSData.clearAlert(id)
SBSData.onAlert(cb)
```

Alert thresholds (from Open-Meteo data, evaluated in `portal.js`):
- Wind ≥ 25kn → advisory (orange)
- Wind ≥ 34kn → urgent/gale (red)
- Precip ≥ 60% → advisory
- WMO code 95-99 (thunderstorm) → urgent

MOB alert triggered by MOB button in `sbs-chart.js` / `helm.js`.

---

## SignalK WebSocket Protocol

SignalK v1 stream delivers deltas:
```json
{
  "updates": [{
    "source": { "label": "...", "type": "..." },
    "timestamp": "2026-03-26T...",
    "values": [
      { "path": "navigation.speedOverGround", "value": 2.57 }
    ]
  }]
}
```

`sbs-data.js` processes each delta, updates internal state map, and fires any subscribers for changed paths.

### AIS Data
AIS targets arrive as:
```json
{ "context": "vessels.urn:mrn:imo:mmsi:123456789", "updates": [...] }
```

`sbs-data.js` maintains a `vessels` map keyed by MMSI. Each entry: `{ name, mmsi, position, sog, cog, shipType, lastUpdate }`.

---

## relay_server.py Data (polled, not WS)

Temperature and relay state are polled by `portal.js` directly — not via `SBSData`. These are REST calls to `http://sailboatserver.local:5000/`:
- `GET /temps` → `{ cabin, engine, exhaust, water }` in °C
- `GET /relays` → `[{ id, name, state }]` array

`portal.js` polls `/temps` every 30s when Controls drawer is open.

---

## Key Rules

- `SBSData` is a singleton — initialized once, shared across all modules
- Never convert units in UI components — always use `SBSData.get()` which returns normalized values
- Passage state is the single source of truth — `portal.js` writes it, `sbs-data.js` owns it during a session
- Alert levels: `'urgent'` > `'advisory'` > `'info'` — higher level always takes visual precedence
