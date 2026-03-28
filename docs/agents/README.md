# SailboatServer — Agent Team

This directory defines the specialized AI agent roles for the SailboatServer project. Each agent has a focused domain, a known set of files it owns, and a clear interface with other agents.

**Vessel:** SV-Esperanza · **Owner:** Matt Schoenholz

---

## How to Use These Files

Each agent file is an onboarding document for a specialized AI agent (Claude Code, Cursor, etc.). When starting work in a domain:

1. Read `CLAUDE.md` at repo root (hard rules — mandatory)
2. Read the relevant agent file in this directory
3. Read `AGENT_HANDOFF.md` for topology and credentials
4. Dive into `docs/` as needed

---

## Agent Roster

| Agent | File | Domain |
|-------|------|--------|
| UX Designer | `ux-designer.md` | Three-interface UX, design system, HMI |
| Marine Systems | `marine-systems.md` | NMEA, SignalK, GPIO, sensors, hardware |
| Chart & Navigation | `chart-navigation.md` | MapServer, WMS, Leaflet, AIS, ENC charts |
| Frontend | `frontend.md` | HTML/CSS/JS, design system, components |
| Data & Instruments | `data-instruments.md` | sbs-data.js, SignalK WebSocket, data normalization |
| Backend & Pi | `backend-pi.md` | relay_server.py, Flask, nginx, systemd |
| Deploy & Infra | `deploy-infra.md` | deploy.sh, SSH, Tailscale, Pi OS config |
| OpenCPN & OpenPlotter | `opencpn-openplotter.md` | OpenCPN integration, NMEA 2000, OpenPlotter stack |

---

## Architecture Overview

```
Three UIs
├── Helm Display (helm.html)         — cockpit, full-screen, touch
├── Skipper Portal (index.html)      — cabin/remote, planning, controls
└── Crew View (future)               — read-only instruments, phone-friendly

Data Sources
├── SignalK (port 3000)              — NMEA instruments, AIS, GPS
├── relay_server.py (port 5000)      — GPIO relays, DS18B20 temps, system
├── MapServer / nginx (port 80)      — NOAA ENC chart tiles (WMS)
└── External APIs                   — Open-Meteo, OWM, NOAA tides, ERDDAP

Pi Stack
├── nginx                           — static files, WMS proxy, caching
├── fcgiwrap (4 workers)            — MapServer FastCGI
├── SignalK                         — NMEA hub
├── relay.service                   — Flask GPIO API
└── tailscaled                      — remote access VPN
```

See `docs/ARCHITECTURE.md` for full diagrams.

---

## FSD

See `FSD.md` for the Feature Specification Document — the roadmap of planned work, organized by priority and agent ownership.
