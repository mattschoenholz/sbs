# Agent: Backend & Pi

**Project:** SailboatServer — SV-Esperanza
**Domain:** relay_server.py, Flask API, nginx, systemd services, Pi OS configuration

---

## Role

Own the Pi-side server stack: the Flask relay API, nginx configuration, systemd service management, and Pi OS-level configuration (NetworkManager, system settings). Interface between hardware (GPIO, temps) and the frontend.

---

## relay_server.py

**Location on Pi:** `~/relay_server.py`
**Deployed by:** `scripts/deploy.sh` (SCP from Mac)
**Service:** `relay.service` (systemd)
**Port:** 5000

### GPIO Library
**Must use `lgpio`** — `RPi.GPIO` is incompatible with Pi 5 (uses `gpiochip4`).

### Relay Logic
- Active-LOW: `lgpio.gpio_write(handle, pin, 0)` = ON, `= 1` = OFF
- CH4 (Bilge Pump, GPIO16) is safety-critical — never toggle without explicit intent

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/relays` | All relay states: `[{id, name, gpio, state}]` |
| POST | `/relay/<n>` | Set relay n (1-8). Body: `{"state": 0\|1}` |
| GET | `/temps` | DS18B20 readings: `{cabin, engine, exhaust, water}` °C |
| GET | `/system` | CPU temp, load avg, uptime, disk usage |
| GET | `/network` | eth0/wlan0 IPs, Tailscale IP, hostname |
| POST | `/reboot` | Reboot Pi (requires confirmation token) |
| GET | `/starlink` | Starlink dishy status (via `starlink_endpoints.py`) |
| POST | `/wifi/reboot` | Reboot GL.iNet router via SSH (paramiko) |

### GL.iNet Router Control
- `relay_server.py` SSHes to `root@192.168.42.1` to reboot WiFi
- Uses `paramiko` library
- Credentials in `relay_server.py` config section (not in repo secrets — local Pi only)

### DS18B20 Temperature Sensors
- Read via `/sys/bus/w1/devices/28-*/w1_slave`
- Parsed for `t=XXXXX` value (divide by 1000 for °C)
- 4 sensors: cabin, engine, exhaust, water
- Polled every 30s when `/temps` endpoint is called

---

## nginx Configuration

**Config:** `/etc/nginx/sites-available/default` on Pi

Key sections:
- Static file serving from `/var/www/html/`
- `Cache-Control: no-cache` on HTML files
- FastCGI proxy to fcgiwrap for MapServer WMS
- FastCGI cache zone: `mapserv` (30 days, ~500MB at `/var/cache/nginx/mapserv/`)

### FastCGI Cache (WMS Tiles)
- Zone size: ~500MB
- Inactive timeout: 30 days
- Key: `$scheme$request_method$host$request_uri`
- **Cache warming:** Must use `warm.html` in Chrome on x86 Mac — see `agents/chart-navigation.md`

---

## systemd Services

| Service | Unit File | Purpose |
|---------|-----------|---------|
| nginx | system default | Web server |
| relay.service | `/etc/systemd/system/relay.service` | Flask relay API |
| fcgiwrap | `/etc/systemd/system/fcgiwrap.service` + override | 4-worker MapServer CGI |
| signalk | npm-managed | SignalK instrument hub |
| tailscaled | system default | Tailscale VPN |

### relay.service
```ini
[Unit]
Description=SailboatServer Relay API
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/relay_server.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

### fcgiwrap override (4 workers)
```
/etc/systemd/system/fcgiwrap.service.d/override.conf
FCGI_CHILDREN=4
```

### Service Management Commands
```bash
sudo systemctl restart relay.service
sudo systemctl status relay.service
sudo journalctl -u relay.service -f        # live logs
sudo systemctl restart nginx
sudo nginx -t                               # test config before restart
```

---

## NetworkManager (Pi 5)

Pi OS Bookworm uses NetworkManager — **not** dhcpcd or `/etc/network/interfaces`.

### Current Static IP Config
- Connection: `"Wired connection 1"` (eth0)
- IP: `192.168.42.201/24`
- Gateway: `192.168.42.1`
- DNS: `8.8.8.8, 8.8.4.4`

### Change IP
```bash
sudo nmcli connection modify "Wired connection 1" \
  ipv4.addresses 192.168.42.201/24 \
  ipv4.gateway 192.168.42.1 \
  ipv4.dns "8.8.8.8 8.8.4.4" \
  ipv4.method manual
sudo nmcli connection up "Wired connection 1"
```
**Run as single line** — shell backslash continuations in SSH cause parsing errors.

---

## Pi Filesystem Key Paths

| Path | Contents |
|------|---------|
| `/var/www/html/` | Web portal files |
| `/etc/nginx/sites-available/default` | nginx config |
| `/etc/mapserver/enc.map` | MapServer mapfile |
| `/var/cache/nginx/mapserv/` | WMS tile cache |
| `~/relay_server.py` | Flask relay API |
| `~/.signalk/` | SignalK config (no hardcoded IPs) |

---

## Python Requirements (`requirements.txt`)

```
flask
flask-cors
lgpio
paramiko
requests
```

Install on Pi:
```bash
pip3 install -r requirements.txt
```
