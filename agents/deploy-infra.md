# Agent: Deploy & Infra

**Project:** SailboatServer — SV-Esperanza
**Domain:** Deployment workflow, SSH, Tailscale, Pi OS networking, service management

---

## Role

Own the deployment pipeline and infrastructure layer: `scripts/deploy.sh`, SSH access patterns, Tailscale VPN, Pi network configuration, and anything that connects the Mac development environment to the Pi.

---

## Network Topology

```
Mac (dev) ─── home WiFi ─── ASUS router (192.168.50.x)
                                 └── GL.iNet (192.168.42.x)
                                       └── Pi eth0: 192.168.42.201
                                       └── ESP32 WiFi: 192.168.42.50
Pi ──── Tailscale: 100.109.248.77
Mac ─── Tailscale: 100.83.131.77
```

| Network | Subnet | Notes |
|---------|--------|-------|
| Home | 192.168.50.x | ASUS router |
| Boat GL.iNet | 192.168.42.x | Pi + ESP32 |
| Van GL.iNet | 192.168.8.x | Different router |
| Starlink (Van) | 192.168.100.x | Avoid conflict on boat |

---

## SSH Access

```bash
ssh pi@sailboatserver.local    # on boat network (192.168.42.x)
ssh pi@192.168.42.201          # direct IP, boat network
ssh pi@100.109.248.77          # Tailscale (any network, recommended for remote)
```

---

## Deployment

### Standard Deploy (local network)
```bash
bash scripts/deploy.sh
```

### Remote Deploy (Tailscale)
```bash
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

### What deploy.sh Does
1. SCP web files (`index.html`, `helm.html`, `js/`, `css/`, `vendor/`, `warm.html`, etc.) to `/var/www/html/`
2. SCP `relay_server.py` to `~/relay_server.py` on Pi
3. Injects `?v=<timestamp>` into all `.js` and `.css` `<script>`/`<link>` tags in HTML files
4. Restarts `relay.service` via SSH

### Cache-Busting Rule
`deploy.sh` parses HTML for `src="..."` and `href="..."` patterns on `.js`/`.css` files. Any new file added to HTML must use bare `src=` (not inline or dynamic) so deploy can version it.

---

## Tailscale

- **Pi IP:** `100.109.248.77` (stable, registered to matt.schoenholz@)
- **Mac IP:** `100.83.131.77`
- **Admin:** `https://login.tailscale.com/admin/machines`
- **Pi service:** `tailscaled` (systemd, enabled)

### Tailscale Management on Pi
```bash
tailscale status              # check connection
sudo systemctl restart tailscaled
sudo tailscale up             # re-auth if expired
```

---

## Pi NetworkManager

Pi OS Bookworm uses NetworkManager. **Not** dhcpcd — that's Pi 4 and earlier.

### View Current Config
```bash
nmcli connection show "Wired connection 1" | grep ipv4
ip addr show eth0
```

### Modify Static IP (single line — shell continuations fail in SSH)
```bash
sudo nmcli connection modify "Wired connection 1" ipv4.addresses 192.168.42.201/24 ipv4.gateway 192.168.42.1 ipv4.dns "8.8.8.8 8.8.4.4" ipv4.method manual
sudo nmcli connection up "Wired connection 1"
```

### Delayed Network Switch (safe for remote sessions)
Use when you need to switch IPs without losing connectivity:
```bash
nohup bash -c 'sleep 90 && sudo nmcli connection up "Wired connection 1"' > /tmp/nmcli-switch.log 2>&1 &
```
Then switch the router subnet within 90 seconds. SSH session may survive if Tailscale reconnects quickly.

---

## GL.iNet Router

- **Model:** GL-AR300M (pocket travel router, OpenWRT/LuCI)
- **Admin LAN:** `http://192.168.42.1` (LuCI web UI)
- **SSH:** `root@192.168.42.1`
- **WAN:** Connected to home ASUS router at 192.168.50.213
- **DHCP reservation:** Pi MAC `2c:cf:67:d5:c4:be` → `192.168.42.201`
  - Set in LuCI: Network → DHCP and DNS → Static Leases

---

## Pi Service Management

```bash
# Relay API
sudo systemctl restart relay.service
sudo journalctl -u relay.service -f

# nginx
sudo systemctl restart nginx
sudo nginx -t

# SignalK
sudo systemctl restart signalk

# fcgiwrap
sudo systemctl restart fcgiwrap

# Check all
sudo systemctl status relay.service nginx fcgiwrap signalk tailscaled
```

---

## Deployment Checklist

Before deploying major changes:
1. Test locally if possible
2. Run `bash scripts/deploy.sh` (or with `PI_HOST=...` for remote)
3. Check `relay.service` restarted: `sudo systemctl status relay.service`
4. Verify portal loads: `http://sailboatserver.local` or `http://100.109.248.77`
5. Check browser console for JS errors
6. If chart changes: re-warm tile cache with `warm.html` in Chrome on Mac

---

## ESPHome (ESP32 Sensor Node)

```bash
# Flash via USB (ESP32 connected to Mac)
esphome run sv_esperanza_sensors.yaml --device /dev/ttyUSB0

# OTA update (ESP32 on boat WiFi 192.168.42.50)
esphome run sv_esperanza_sensors.yaml

# Compile only (no flash)
esphome compile sv_esperanza_sensors.yaml
```

Secrets in `secrets.yaml` (git-ignored). Never commit credentials.

**Known issue:** `fatfs` Python package conflict with Python 3.14.
Fix: `pip3 uninstall fatfs && pip3 install fatfs_ng`
