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

app = Flask(__name__)
CORS(app)  # Required for portal (port 80) to reach relay API (port 5000)

# ============================================================
# CONFIGURATION — edit these values for your installation
# ============================================================

# ── RELAY PINS (Waveshare Relay Board B — active LOW) ────────
# Jumpers physically moved from Waveshare defaults to avoid MacArthur HAT conflicts.
# CH1 moved: GPIO5 (UART2 RX / VHF in)  → GPIO20 (pin 38)
# CH3 moved: GPIO13 (UART4 RX / TP22 in) → GPIO21 (pin 40)
# CH5–CH8 moved earlier to clear 1-Wire and UART conflicts.
# See docs/GPIO_PIN_MAPPING.md for full history.
RELAY_PINS = {
    1: 20,    # CH1 — Cabin Lights        (jumper: GPIO5 → GPIO20)
    2:  6,    # CH2 — Navigation Lights
    3: 21,    # CH3 — Anchor Light        (jumper: GPIO13 → GPIO21)
    4: 16,    # CH4 — Bilge Pump          ← SAFETY CRITICAL
    5: 25,    # CH5 — Water Pump          (jumper: GPIO17 → GPIO25)
    6: 24,    # CH6 — Vent Fan            (jumper: GPIO18 → GPIO24)
    7: 18,    # CH7 — Instruments         (jumper: GPIO24 → GPIO18)
    8: 17,    # CH8 — Starlink Power      (jumper: GPIO25 → GPIO17)
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
# Internal pull-ups enabled — LOW = switch ON.
# Switches not yet wired; pins chosen to avoid all active conflicts.
# Key = relay channel number controlled by that switch.
SWITCH_PINS = {
    4:  6,   # SW1 → CH4 Bilge Pump        ← SAFETY CRITICAL (GPIO6 / pin 31)
    2: 22,   # SW2 → CH2 Navigation Lights  (GPIO22 / pin 15)
    3: 23,   # SW3 → CH3 Anchor Light       (GPIO23 / pin 16)
    1: 26,   # SW4 → CH1 Cabin Lights       (GPIO26 / pin 37)
    6: 27,   # SW5 → CH6 Vent Fan           (GPIO27 / pin 13)
}

# ── 1-WIRE TEMPERATURE SENSORS ───────────────────────────────
# Addresses mapped during installation on 2026-03-08
# Verify with: ls /sys/bus/w1/devices/
W1_SENSORS = {
    "exhaust":  "28-000000240cbd",
    "water":    "28-000000251764",
    "engine":   "28-0000008327eb",
    "cabin":    "28-00000086defe",
}
W1_BASE = "/sys/bus/w1/devices/{}/w1_slave"

# ── GL.INET ROUTER ───────────────────────────────────────────
ROUTER_IP   = "192.168.8.1"
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
    for ch, pin in SWITCH_PINS.items():
        lgpio.gpio_claim_input(h, pin, lgpio.SET_PULL_UP)

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
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
