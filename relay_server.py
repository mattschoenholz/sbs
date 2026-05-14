#!/usr/bin/env python3
# ============================================================
# SailboatServer — relay_server.py
# Raspberry Pi 5 / SV-Esperanza
#
# Provides HTTP API for:
#   - 8-channel relay control (Waveshare Relay Board B)
#   - Physical manual override switches (5 switches)
#   - 1-Wire temperature sensors (4 x DS18B20)
#   - Starlink status
#   - GL.iNet router control (reboot, wifi restart, devices)
#
# Runs on port 5000
# Managed by systemd as relay.service
# ============================================================

from flask import Flask, jsonify, request
from flask_cors import CORS
import lgpio
import threading
import time
import subprocess
import json
import os
import glob
import paramiko
import requests as http_requests
import math

# RAG — lazy imports so relay starts even if numpy/pypdf not installed yet
try:
    import numpy as np
    _NUMPY_OK = True
except ImportError:
    _NUMPY_OK = False

app = Flask(__name__)
CORS(app)  # Required for portal (port 80) to reach relay API (port 5000)

# ============================================================
# CONFIGURATION — edit these values for your installation
# ============================================================

# ── RELAY PINS (Waveshare Relay Board B — active LOW) ────────
# Current assignments are conflict-free for all hardware currently wired.
#
# LATENT CONFLICTS — require jumper moves on Waveshare board before wiring:
#   CH1 GPIO5  (pin 29): shares UART2 RX with MacArthur HAT VHF radio input.
#     → When VHF TX is wired: move CH1 jumper from GPIO5 (pin 29) to GPIO14 (pin 8).
#   CH3 GPIO13 (pin 33): shares UART4 RX with MacArthur HAT TP22 autotiller input.
#     → When TP22 TX is wired: move CH3 jumper from GPIO13 (pin 33) to GPIO15 (pin 10).
#
# Jumper moves require no soldering — Waveshare board uses 2-pin header jumpers.
# See docs/GPIO_PIN_MAPPING.md for full history and HAT pin audit.
RELAY_PINS = {
    1: 22,    # CH1 — Cabin Lights        GPIO22 / pin 15  (moved 5→14→22; GPIO14 freed for MAIANA UART0 TX)
    2:  6,    # CH2 — Navigation Lights   GPIO6  / pin 31
    3: 23,    # CH3 — Anchor Light        GPIO23 / pin 16  (moved 13→15→23; GPIO15 freed for MAIANA UART0 RX)
    4: 16,    # CH4 — Bilge Pump          GPIO16 / pin 36  ← SAFETY CRITICAL
    5: 25,    # CH5 — Water Pump          GPIO25 / pin 22  (rewired: 17→25)
    6: 24,    # CH6 — Vent Fan            GPIO24 / pin 18  (rewired: 18→24)
    7: 18,    # CH7 — Instruments         GPIO18 / pin 12  (rewired: 24→18)
    8: 17,    # CH8 — Starlink Power      GPIO17 / pin 11  (rewired: 25→17)
}

RELAY_NAMES = {
    1: "Cabin Lights",
    2: "Navigation Lights",
    3: "Anchor Light",
    4: "Bilge Pump",
    5: "Water Pump",
    6: "Vent Fan",
    7: "Instruments",
    8: "Starlink Power",
}

# ── MANUAL OVERRIDE SWITCH PINS ─────────────────────────────
# Physical toggle switches wired to GPIO, other end to GND.
# Internal pull-ups enabled — LOW = switch closed = ON.
# Key = relay channel number the switch controls.
#
# Critical switches (bilge, nav lights, anchor light) wired directly to Pi —
# no network dependency, zero latency.
#
# SW4 (CH1 Cabin Lights) → ESP32 GPIO32 — POSTs /relay/1 toggle via HTTP
# SW5 (CH6 Vent Fan)     → ESP32 GPIO33 — POSTs /relay/6 toggle via HTTP
# Non-critical; latency acceptable. If ESP32 is down, relay still controllable via web UI.
#
# GPIO14/15 left free — reserved for MAIANA AIS transponder UART0.
SWITCH_PINS = {
    4: 20,   # SW1 → CH4 Bilge Pump     GPIO20 / pin 38  ← SAFETY CRITICAL
    2: 26,   # SW2 → CH2 Nav Lights     GPIO26 / pin 37
    3: 27,   # SW3 → CH3 Anchor Light   GPIO27 / pin 13
}

# ── 1-WIRE TEMPERATURE SENSORS ───────────────────────────────
# Addresses mapped during installation on 2026-03-08
# Verify with: ls /sys/bus/w1/devices/
W1_SENSORS = {
    # engine + exhaust moved to ESP32 1-Wire (GPIO25) → SignalK via NMEA XDR
    "water":    "28-000000251764",
    "cabin":    "28-00000086defe",
}
W1_BASE = "/sys/bus/w1/devices/{}/w1_slave"

# ── GL.INET ROUTER ───────────────────────────────────────────
ROUTER_IP   = "192.168.42.1"
ROUTER_USER = "root"
ROUTER_KEY  = os.path.expanduser("~/.ssh/id_rsa_router")
ROUTER_IFACE = "eth0"

# ── STARLINK ─────────────────────────────────────────────────
STARLINK_IP = "192.168.100.1"

# ── SWITCH POLL INTERVAL ─────────────────────────────────────
SWITCH_POLL_MS = 100   # milliseconds between switch state checks

# ============================================================
# GPIO INITIALISATION
# ============================================================

h = None          # lgpio chip handle
relay_states = {ch: False for ch in RELAY_PINS}   # False = OFF
switch_last  = {ch: False for ch in SWITCH_PINS}  # last switch state

def init_gpio():
    """
    Claim all relay output pins and drive them HIGH (relay OFF).
    Claim all switch input pins with pull-ups.
    Called once at startup to prevent floating pin issues.
    """
    global h
    h = lgpio.gpiochip_open(4)  # Pi 5 uses gpiochip4 for GPIO header

    # Relay outputs — HIGH = relay OFF (active LOW board)
    # None guard: skip unassigned channels (e.g. CH5 if jumper removed)
    for ch, pin in RELAY_PINS.items():
        if pin is not None:
            lgpio.gpio_claim_output(h, pin, 1)

    # Switch inputs — pull-up, LOW = switch pressed
    # Switches not yet physically wired; skip busy pins gracefully.
    for ch, pin in SWITCH_PINS.items():
        try:
            lgpio.gpio_claim_input(h, pin, lgpio.SET_PULL_UP)
        except lgpio.error as e:
            print(f"Switch CH{ch} GPIO{pin} unavailable ({e}) — skipping")

    # Seed switch_last with actual pin state so the first poll never
    # generates a false rising edge on a floating or grounded input.
    for ch, pin in SWITCH_PINS.items():
        try:
            switch_last[ch] = (lgpio.gpio_read(h, pin) == 0)
        except lgpio.error:
            switch_last[ch] = False

    print("GPIO initialised — all relays OFF")


def set_relay(channel, state):
    """
    Set relay channel ON (True) or OFF (False).
    Waveshare Relay Board B is active LOW:
      GPIO LOW  (0) = relay coil energised = circuit CLOSED = ON
      GPIO HIGH (1) = relay coil released  = circuit OPEN   = OFF
    """
    if channel not in RELAY_PINS:
        return False
    pin = RELAY_PINS[channel]
    if pin is None:
        relay_states[channel] = state  # track state but no physical output
        return True
    gpio_level = 0 if state else 1
    lgpio.gpio_write(h, pin, gpio_level)
    relay_states[channel] = state
    return True


def get_relay_states():
    """Return dict of all relay states."""
    return {str(ch): relay_states[ch] for ch in RELAY_PINS}


# ============================================================
# MANUAL OVERRIDE SWITCH POLLING
# ============================================================

def poll_switches():
    """
    Poll physical override switches every SWITCH_POLL_MS.
    Toggles corresponding relay on rising edge (switch press).
    Runs in background thread.
    """
    global switch_last
    while True:
        for relay_ch, pin in SWITCH_PINS.items():
            level = lgpio.gpio_read(h, pin)
            pressed = (level == 0)   # active LOW
            if pressed and not switch_last[relay_ch]:
                # Rising edge — toggle relay
                new_state = not relay_states[relay_ch]
                set_relay(relay_ch, new_state)
                print(f"Switch override: CH{relay_ch} "
                      f"{'ON' if new_state else 'OFF'}")
            switch_last[relay_ch] = pressed
        time.sleep(SWITCH_POLL_MS / 1000.0)


# ============================================================
# 1-WIRE TEMPERATURE SENSORS
# ============================================================

def read_w1_temp(sensor_id):
    """
    Read temperature in Celsius from a DS18B20 1-Wire sensor.
    Returns float or None if read fails.
    """
    path = W1_BASE.format(sensor_id)
    try:
        with open(path, 'r') as f:
            lines = f.readlines()
        if lines[0].strip().endswith('YES'):
            temp_str = lines[1].split('t=')[1].strip()
            return round(float(temp_str) / 1000.0, 2)
    except Exception as e:
        print(f"1-Wire read error {sensor_id}: {e}")
    return None


def read_all_temps():
    """Read all four temperature sensors. Returns dict."""
    temps = {}
    for name, sensor_id in W1_SENSORS.items():
        temps[name] = read_w1_temp(sensor_id)
    return temps


# ============================================================
# STARLINK STATUS
# ============================================================

def get_starlink_status():
    """
    Ping Starlink dish to determine online/offline status.
    Returns dict with status and latency.
    """
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "2", STARLINK_IP],
            capture_output=True, text=True, timeout=3
        )
        if result.returncode == 0:
            # Extract latency from ping output
            for line in result.stdout.split('\n'):
                if 'time=' in line:
                    latency = line.split('time=')[1].split(' ')[0]
                    return {"online": True, "latency_ms": float(latency)}
            return {"online": True, "latency_ms": None}
        else:
            return {"online": False, "latency_ms": None}
    except Exception as e:
        return {"online": False, "error": str(e)}


# ============================================================
# GL.INET ROUTER SSH HELPERS
# ============================================================

def router_ssh(command, timeout=10):
    """
    Execute a command on the GL.iNet router via SSH.
    Returns (stdout, stderr, returncode).
    """
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            ROUTER_IP,
            username=ROUTER_USER,
            key_filename=ROUTER_KEY,
            timeout=timeout,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}
        )
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        rc  = stdout.channel.recv_exit_status()
        client.close()
        return out, err, rc
    except Exception as e:
        return "", str(e), -1


# ============================================================
# API ROUTES — RELAY CONTROL
# ============================================================

@app.route('/relay/status', methods=['GET'])
def relay_status():
    """
    Relay states in format expected by SBSData/portal frontend.
    Returns { channels: [{ channel: 1, state: false }, ...] }
    """
    states = get_relay_states()
    channels = [{"channel": int(ch), "state": state} for ch, state in states.items()]
    return jsonify({"channels": channels})


@app.route('/relays', methods=['GET'])
def get_relays():
    """Get all relay states."""
    states = get_relay_states()
    result = {}
    for ch_str, state in states.items():
        ch = int(ch_str)
        result[ch_str] = {
            "state": state,
            "name": RELAY_NAMES.get(ch, f"Channel {ch}")
        }
    return jsonify(result)


@app.route('/relay/<int:channel>', methods=['POST'])
def control_relay(channel):
    """
    Set relay state.
    Body: {"state": true|false}
    Or use action: {"action": "on"|"off"|"toggle"}
    """
    if channel not in RELAY_PINS:
        return jsonify({"error": f"Invalid channel {channel}"}), 400

    data = request.get_json(silent=True) or {}

    if 'action' in data:
        action = data['action'].lower()
        if action == 'toggle':
            new_state = not relay_states[channel]
        elif action == 'on':
            new_state = True
        elif action == 'off':
            new_state = False
        else:
            return jsonify({"error": f"Unknown action: {action}"}), 400
    elif 'state' in data:
        new_state = bool(data['state'])
    else:
        return jsonify({"error": "Provide 'state' or 'action'"}), 400

    set_relay(channel, new_state)
    return jsonify({
        "channel": channel,
        "name": RELAY_NAMES.get(channel, f"Channel {channel}"),
        "state": relay_states[channel]
    })


@app.route('/relays/off', methods=['POST'])
def all_relays_off():
    """Turn all relays OFF."""
    for ch in RELAY_PINS:
        set_relay(ch, False)
    return jsonify({"message": "All relays OFF", "states": get_relay_states()})


# ============================================================
# API ROUTES — TEMPERATURE SENSORS
# ============================================================

@app.route('/temperatures', methods=['GET'])
def get_temperatures():
    """
    Read all four DS18B20 1-Wire temperature sensors.
    Returns Celsius values for cabin, engine, exhaust, water.
    """
    temps = read_all_temps()
    result = {}
    for name, temp_c in temps.items():
        result[name] = {
            "celsius": temp_c,
            "fahrenheit": round(temp_c * 9/5 + 32, 2) if temp_c is not None else None,
            "sensor_id": W1_SENSORS[name]
        }
    return jsonify(result)


@app.route('/temperature/<sensor_name>', methods=['GET'])
def get_temperature(sensor_name):
    """Read a single temperature sensor by name."""
    if sensor_name not in W1_SENSORS:
        return jsonify({
            "error": f"Unknown sensor '{sensor_name}'",
            "valid": list(W1_SENSORS.keys())
        }), 400
    temp_c = read_w1_temp(W1_SENSORS[sensor_name])
    return jsonify({
        "sensor": sensor_name,
        "celsius": temp_c,
        "fahrenheit": round(temp_c * 9/5 + 32, 2) if temp_c is not None else None,
        "sensor_id": W1_SENSORS[sensor_name]
    })


# ============================================================
# API ROUTES — STARLINK
# ============================================================

@app.route('/starlink', methods=['GET'])
def starlink_status():
    """Get Starlink online/offline status."""
    return jsonify(get_starlink_status())


# ============================================================
# API ROUTES — GL.INET ROUTER
# ============================================================

@app.route('/router/reboot', methods=['POST'])
def router_reboot():
    """Reboot the GL.iNet router."""
    out, err, rc = router_ssh("reboot")
    if rc == 0 or rc == -1:   # -1 expected as connection drops immediately
        return jsonify({"message": "Router rebooting"})
    return jsonify({"error": err}), 500


@app.route('/router/wifi-restart', methods=['POST'])
def router_wifi_restart():
    """Restart GL.iNet Wi-Fi radio without full reboot."""
    out, err, rc = router_ssh("wifi down && sleep 2 && wifi up")
    if rc == 0:
        return jsonify({"message": "Wi-Fi restarted"})
    return jsonify({"error": err}), 500


@app.route('/router/devices', methods=['GET'])
def router_devices():
    """Get list of devices connected to GL.iNet router."""
    out, err, rc = router_ssh(
        "cat /tmp/dhcp.leases 2>/dev/null; echo '---'; arp -n 2>/dev/null"
    )
    if rc != 0:
        return jsonify({"error": err}), 500

    devices = []
    seen_ips = set()

    for line in out.split('\n'):
        if '---' in line:
            break
        parts = line.strip().split()
        if len(parts) >= 4:
            ip  = parts[2]
            mac = parts[1]
            hostname = parts[3] if parts[3] != '*' else 'unknown'
            if ip not in seen_ips:
                devices.append({"ip": ip, "mac": mac, "hostname": hostname})
                seen_ips.add(ip)

    return jsonify({"devices": devices, "count": len(devices)})


# ============================================================
# API ROUTES — SYSTEM
# ============================================================

@app.route('/status', methods=['GET'])
def system_status():
    """
    Full system status — relays, temperatures, Starlink.
    Used by portal on page load.
    """
    return jsonify({
        "relays":       get_relay_states(),
        "relay_names":  RELAY_NAMES,
        "temperatures": read_all_temps(),
        "starlink":     get_starlink_status(),
    })


@app.route('/health', methods=['GET'])
def health():
    """Simple health check endpoint."""
    return jsonify({"status": "ok", "service": "relay_server"})


# ============================================================
# API ROUTES — HOTSPOT
# ============================================================

def get_hotspot_active():
    """Check if OpenPlotter hotspot is currently active."""
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "NAME,STATE", "connection", "show", "--active"],
            capture_output=True, text=True, timeout=5
        )
        return "OpenPlotter-Hotspot" in result.stdout
    except Exception:
        return False


@app.route('/hotspot/on', methods=['POST'])
def hotspot_on():
    """Bring up the OpenPlotter hotspot."""
    try:
        result = subprocess.run(
            ["sudo", "nmcli", "connection", "up", "OpenPlotter-Hotspot"],
            capture_output=True, text=True, timeout=10
        )
        active = get_hotspot_active()
        return jsonify({"active": active, "message": "Hotspot started" if active else result.stderr})
    except Exception as e:
        return jsonify({"active": False, "error": str(e)}), 500


@app.route('/hotspot/off', methods=['POST'])
def hotspot_off():
    """Bring down the OpenPlotter hotspot."""
    try:
        result = subprocess.run(
            ["sudo", "nmcli", "connection", "down", "OpenPlotter-Hotspot"],
            capture_output=True, text=True, timeout=10
        )
        active = get_hotspot_active()
        return jsonify({"active": active, "message": "Hotspot stopped" if not active else result.stderr})
    except Exception as e:
        return jsonify({"active": True, "error": str(e)}), 500


@app.route('/hotspot/status', methods=['GET'])
def hotspot_status():
    """Get hotspot active/inactive status."""
    return jsonify({"active": get_hotspot_active()})


# ============================================================
# API ROUTES — SYSTEM POWER
# ============================================================

@app.route('/system/reboot', methods=['POST'])
def system_reboot():
    """Reboot the Pi. Runs after a short delay so response can be sent first."""
    def do_reboot():
        time.sleep(2)
        subprocess.run(["sudo", "reboot"])
    threading.Thread(target=do_reboot, daemon=True).start()
    return jsonify({"message": "Rebooting in 2 seconds"})


@app.route('/system/shutdown', methods=['POST'])
def system_shutdown():
    """Shut down the Pi. Runs after a short delay so response can be sent first."""
    def do_shutdown():
        time.sleep(2)
        subprocess.run(["sudo", "shutdown", "-h", "now"])
    threading.Thread(target=do_shutdown, daemon=True).start()
    return jsonify({"message": "Shutting down in 2 seconds"})


@app.route('/system/restart-kiwix', methods=['POST'])
def restart_kiwix():
    """Restart kiwix.service so newly added ZIM files are picked up."""
    result = subprocess.run(
        ["sudo", "systemctl", "restart", "kiwix"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        return jsonify({"message": "Kiwix restarting — library will be back in ~10 seconds"})
    else:
        return jsonify({"error": result.stderr.strip() or "Failed to restart kiwix"}), 500


# ============================================================
# WIND GRID — Open-Meteo parallel fetch → leaflet-velocity JSON
# Fetches a grid of forecast points and converts wind speed/direction
# to U/V components for animated display with leaflet-velocity.
# ============================================================

_wind_cache = {}  # key → {data, ts}

def _fetch_point(lat, lon, results, key):
    """Fetch current wind for one grid point from Open-Meteo."""
    try:
        url = (f'https://api.open-meteo.com/v1/forecast'
               f'?latitude={lat:.1f}&longitude={lon:.1f}'
               f'&current=windspeed_10m,winddirection_10m'
               f'&wind_speed_unit=kn&forecast_days=1')
        r = http_requests.get(url, timeout=12)
        r.raise_for_status()
        c = r.json().get('current', {})
        spd_kt  = c.get('windspeed_10m', 0) or 0
        direction = c.get('winddirection_10m', 0) or 0
        ref_time  = c.get('time', '')
        # Convert kt → m/s, then to U/V (meteorological convention)
        spd_ms = spd_kt / 1.94384
        rad    = math.radians(direction)
        u = -spd_ms * math.sin(rad)
        v = -spd_ms * math.cos(rad)
        results[key] = (round(u, 2), round(v, 2), ref_time)
    except Exception:
        results[key] = (0, 0, '')

@app.route('/api/wind-grid')
def wind_grid():
    try:
        lat1 = float(request.args.get('lat1', 40))
        lon1 = float(request.args.get('lon1', -130))
        lat2 = float(request.args.get('lat2', 50))
        lon2 = float(request.args.get('lon2', -120))

        # Snap to integer degrees
        la1 = int(round(lat1)); la2 = int(round(lat2))
        lo1 = int(round(lon1)); lo2 = int(round(lon2))
        cache_key = f'{la1},{lo1},{la2},{lo2}'

        cached = _wind_cache.get(cache_key)
        if cached and (time.time() - cached['ts']) < 1800:  # 30-min cache
            return jsonify(cached['data'])

        # Build 1° grid, capped at ~12 points per axis to limit requests
        lat_range = la2 - la1
        lon_range = lo2 - lo1
        lat_step  = max(1, lat_range // 8)
        lon_step  = max(1, lon_range // 8)
        lats = list(range(la1, la2 + 1, lat_step))
        lons = list(range(lo1, lo2 + 1, lon_step))

        # Parallel fetch — all points simultaneously
        results = {}
        threads = [
            threading.Thread(target=_fetch_point, args=(lat, lon, results, (lat, lon)))
            for lat in lats for lon in lons
        ]
        for t in threads: t.start()
        for t in threads: t.join(timeout=18)

        if not results:
            return jsonify({'error': 'No wind data retrieved'}), 500

        ref_time = next((v[2] for v in results.values() if v[2]), '')
        dx = float(lons[1] - lons[0]) if len(lons) > 1 else 1.0
        dy = float(lats[1] - lats[0]) if len(lats) > 1 else 1.0

        u_arr, v_arr = [], []
        for lat in reversed(lats):   # north → south (leaflet-velocity row order)
            for lon in lons:          # west → east
                u, v, _ = results.get((lat, lon), (0, 0, ''))
                u_arr.append(u); v_arr.append(v)

        hdr = {
            'parameterCategory': 2,
            'la1': max(lats), 'lo1': min(lons),
            'dx': dx, 'dy': dy,
            'nx': len(lons), 'ny': len(lats),
            'refTime': ref_time,
        }
        velocity_data = [
            dict(header={**hdr, 'parameterNumber': 2}, data=u_arr),
            dict(header={**hdr, 'parameterNumber': 3}, data=v_arr),
        ]

        _wind_cache[cache_key] = {'data': velocity_data, 'ts': time.time()}
        return jsonify(velocity_data)

    except Exception as e:
        app.logger.error('wind-grid error: %s', e)
        return jsonify({'error': str(e)}), 500


# ============================================================
# RAG — Retrieval Augmented Generation
# Serves top-k relevant document chunks for the AI assistant.
# Index is built by scripts/index_docs.py on the Pi.
# ============================================================

RAG_CHUNKS_FILE = os.path.expanduser("~/rag_chunks.json")
RAG_EMBED_FILE  = os.path.expanduser("~/rag_embeddings.npy")
OLLAMA_EMBED_URL = "http://127.0.0.1:11434/api/embeddings"
RAG_EMBED_MODEL  = "nomic-embed-text"

_rag_chunks = None       # list of {source, page, text}
_rag_matrix = None       # numpy array (N, dims)
_rag_lock   = threading.Lock()


def _load_rag_index():
    """Load index from disk into memory. Returns True if successful."""
    global _rag_chunks, _rag_matrix
    if not _NUMPY_OK:
        return False
    if not os.path.exists(RAG_CHUNKS_FILE) or not os.path.exists(RAG_EMBED_FILE):
        return False
    try:
        with open(RAG_CHUNKS_FILE) as f:
            data = json.load(f)
        _rag_chunks = data["chunks"]
        _rag_matrix = np.load(RAG_EMBED_FILE).astype(np.float32)
        # Normalise rows for fast cosine similarity via dot product
        norms = np.linalg.norm(_rag_matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1
        _rag_matrix = _rag_matrix / norms
        app.logger.info("RAG index loaded: %d chunks", len(_rag_chunks))
        return True
    except Exception as e:
        app.logger.error("RAG index load failed: %s", e)
        return False


def _get_embedding(text: str) -> "np.ndarray | None":
    """Embed text via Ollama nomic-embed-text."""
    try:
        r = http_requests.post(
            OLLAMA_EMBED_URL,
            json={"model": RAG_EMBED_MODEL, "prompt": text},
            timeout=15
        )
        r.raise_for_status()
        vec = np.array(r.json()["embedding"], dtype=np.float32)
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec
    except Exception as e:
        app.logger.error("RAG embed error: %s", e)
        return None


# Load index at startup (non-blocking — fails silently if not built yet)
threading.Thread(target=_load_rag_index, daemon=True).start()


@app.route('/api/rag', methods=['GET'])
def rag_query():
    """
    Query the RAG index.
    GET /api/rag?q=<query>&k=3
    Returns top-k relevant document chunks with source and page.
    """
    global _rag_chunks, _rag_matrix

    if not _NUMPY_OK:
        return jsonify({"error": "numpy not installed"}), 503

    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({"error": "q parameter required"}), 400

    k = min(int(request.args.get('k', 3)), 8)

    with _rag_lock:
        if _rag_chunks is None:
            if not _load_rag_index():
                return jsonify({
                    "error": "Index not built yet",
                    "hint": "Run python3 ~/index_docs.py on the Pi"
                }), 503

        vec = _get_embedding(query)
        if vec is None:
            return jsonify({"error": "Embedding failed — is Ollama running?"}), 503

        # Cosine similarity (rows already normalised → pure dot product)
        scores = _rag_matrix @ vec
        top_idx = np.argsort(scores)[::-1][:k]

        results = []
        for i in top_idx:
            i = int(i)
            chunk = _rag_chunks[i]
            results.append({
                "score":  float(scores[i]),
                "source": chunk["source"],
                "page":   chunk["page"],
                "text":   chunk["text"],
            })

    return jsonify({"query": query, "results": results})


@app.route('/api/rag/status', methods=['GET'])
def rag_status():
    """Return index status — chunk count, model, created timestamp."""
    if not os.path.exists(RAG_CHUNKS_FILE):
        return jsonify({"indexed": False, "hint": "Run python3 ~/index_docs.py"})
    try:
        with open(RAG_CHUNKS_FILE) as f:
            meta = json.load(f)
        return jsonify({
            "indexed":  True,
            "count":    meta.get("count", 0),
            "model":    meta.get("model"),
            "created":  meta.get("created"),
            "loaded":   _rag_chunks is not None,
        })
    except Exception as e:
        return jsonify({"indexed": False, "error": str(e)})


@app.route('/api/rag/reindex', methods=['POST'])
def rag_reindex():
    """Trigger a background reindex of /var/www/html/docs/."""
    global _rag_chunks, _rag_matrix
    script = os.path.expanduser("~/index_docs.py")
    if not os.path.exists(script):
        return jsonify({"error": f"{script} not found — run deploy first"}), 404

    def _run():
        global _rag_chunks, _rag_matrix
        subprocess.run(["python3", script], capture_output=True)
        with _rag_lock:
            _rag_chunks = None
            _rag_matrix = None
            _load_rag_index()

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"message": "Reindexing started — takes 1-3 min. Check /api/rag/status."})


# ============================================================
# AUTOPILOT — SignalK course control for TP22 autotiller
# Sets active destination in SignalK; signalk-to-nmea0183 plugin
# converts to RMB/APB/XTE sentences on /dev/ttyAMA4 → TP22.
#
# PREREQUISITE: Before enabling UART4 output in SignalK:
#   Move relay CH3 jumper on Waveshare board GPIO13 → GPIO15  ← DONE
#   RELAY_PINS[3] updated to 15 — deploy and restart relay before wiring TP22 TX.
# ============================================================

SIGNALK_URL = "http://127.0.0.1:3000"


@app.route('/autopilot/activate', methods=['POST'])
def autopilot_activate():
    """
    Set the active navigation destination in SignalK.
    SignalK then emits RMB/APB/XTE via signalk-to-nmea0183 → TP22.
    POST /autopilot/activate
    Body: {"lat": 47.6, "lon": -122.3, "name": "WP1"}
    """
    data = request.get_json()
    if not data or 'lat' not in data or 'lon' not in data:
        return jsonify({"error": "lat and lon required"}), 400
    lat  = float(data['lat'])
    lon  = float(data['lon'])
    name = data.get('name', 'Autopilot WP')
    try:
        r = http_requests.put(
            f"{SIGNALK_URL}/signalk/v2/api/vessels/self/navigation/course/destination",
            json={"position": {"latitude": lat, "longitude": lon}, "name": name},
            timeout=5
        )
        if r.status_code in (200, 201, 204):
            app.logger.info("Autopilot destination set: %s (%.5f, %.5f)", name, lat, lon)
            return jsonify({"message": f"Steering to {name}", "active": True,
                            "lat": lat, "lon": lon, "name": name})
        return jsonify({"error": f"SignalK {r.status_code}: {r.text[:200]}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/autopilot/deactivate', methods=['POST'])
def autopilot_deactivate():
    """Clear the active destination from SignalK — stops NMEA output to TP22."""
    try:
        http_requests.delete(
            f"{SIGNALK_URL}/signalk/v2/api/vessels/self/navigation/course/destination",
            timeout=5
        )
        return jsonify({"message": "Autopilot disengaged", "active": False})
    except Exception as e:
        return jsonify({"error": str(e), "active": False}), 500


@app.route('/autopilot/status', methods=['GET'])
def autopilot_status():
    """Return current autopilot destination from SignalK course API."""
    try:
        r = http_requests.get(
            f"{SIGNALK_URL}/signalk/v2/api/vessels/self/navigation/course",
            timeout=5
        )
        if r.status_code == 200:
            course = r.json()
            nxt = course.get('nextPoint') or {}
            pos = nxt.get('position') or {}
            active = pos.get('latitude') is not None
            return jsonify({
                "active": active,
                "destination": {
                    "lat":  pos.get('latitude'),
                    "lon":  pos.get('longitude'),
                    "name": nxt.get('name', ''),
                }
            })
    except Exception as e:
        app.logger.warning("autopilot_status error: %s", e)
    return jsonify({"active": False})


TP22_URL = "http://127.0.0.1:5002"

@app.route('/autopilot/heading/engage', methods=['POST'])
def ap_heading_engage():
    """Engage TP22 manual heading mode at current compass heading."""
    data = request.get_json(silent=True) or {}
    try:
        r = http_requests.post(f"{TP22_URL}/engage", json=data, timeout=3)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503

@app.route('/autopilot/heading/adjust', methods=['POST'])
def ap_heading_adjust():
    """Adjust manual heading by delta degrees. Body: {delta: ±1|±10}"""
    data = request.get_json(silent=True) or {}
    try:
        r = http_requests.post(f"{TP22_URL}/adjust", json=data, timeout=3)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503

@app.route('/autopilot/heading/disengage', methods=['POST'])
def ap_heading_disengage():
    """Disengage TP22 manual heading mode."""
    try:
        r = http_requests.post(f"{TP22_URL}/disengage", timeout=3)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 503

@app.route('/autopilot/heading/state', methods=['GET'])
def ap_heading_state():
    """Return current TP22 manual heading state."""
    try:
        r = http_requests.get(f"{TP22_URL}/state", timeout=3)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"mode": "unknown", "engaged": False, "error": str(e)}), 503


# ============================================================
# PASSAGE PLAN — shared state for all devices
# ============================================================

PASSAGE_FILE = os.path.join(os.path.expanduser('~'), 'passage.json')

@app.route('/passage', methods=['GET'])
def passage_get():
    try:
        with open(PASSAGE_FILE) as f:
            return jsonify(json.load(f))
    except FileNotFoundError:
        return jsonify({})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/passage', methods=['POST'])
def passage_save():
    data = request.get_json(silent=True) or {}
    try:
        with open(PASSAGE_FILE, 'w') as f:
            json.dump(data, f)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/passage', methods=['DELETE'])
def passage_delete():
    try:
        if os.path.exists(PASSAGE_FILE):
            os.remove(PASSAGE_FILE)
    except Exception:
        pass
    return jsonify({"ok": True})


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    print("SailboatServer relay_server.py starting...")
    print(f"Relay channels: {len(RELAY_PINS)}")
    print(f"Switch channels: {len(SWITCH_PINS)}")
    print(f"Temperature sensors: {len(W1_SENSORS)}")

    # Initialise GPIO — claims all pins, drives relays OFF
    init_gpio()

    # Start switch polling thread
    switch_thread = threading.Thread(target=poll_switches, daemon=True)
    switch_thread.start()
    print(f"Switch polling started ({SWITCH_POLL_MS}ms interval)")

    # Start Flask
    print("Starting Flask on port 5000...")
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
