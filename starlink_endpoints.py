# ============================================================
# ADD THESE ENDPOINTS TO relay_server.py ON THE Pi
# Paste this entire block just above the line:
#   if __name__ == '__main__':
# ============================================================

import subprocess
import time

ROUTER_IP = '192.168.8.1'       # Default GL.iNet IP — change if yours differs
ROUTER_USER = 'root'             # GL.iNet default SSH user
ROUTER_IFACE = 'eth0'           # WAN-side interface on GL.iNet 300M (may be eth1 — verify with: ssh root@192.168.8.1 cat /proc/net/dev)

# Daily data tracking — resets at midnight
_daily_rx = 0
_daily_tx = 0
_daily_reset_date = None


def get_router_data():
    """SSH into GL.iNet and read /proc/net/dev for byte counts + WAN IP."""
    try:
        result = subprocess.run(
            ['ssh', '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ConnectTimeout=3',
                    '-o', 'BatchMode=yes',
                    f'{ROUTER_USER}@{ROUTER_IP}',
                    f'cat /proc/net/dev && ip route show default'],
            capture_output=True, text=True, timeout=5
        )
        lines = result.stdout.strip().split('\n')
        rx_bytes = 0
        tx_bytes = 0
        wan_ip = '—'

        for line in lines:
            # Find WAN interface line in /proc/net/dev
            stripped = line.strip()
            if stripped.startswith(ROUTER_IFACE + ':'):
                parts = stripped.split(':')[1].split()
                rx_bytes = int(parts[0])   # receive bytes
                tx_bytes = int(parts[8])   # transmit bytes

            # Parse default route for WAN IP
            if 'default via' in stripped:
                parts = stripped.split()
                try:
                    idx = parts.index('src')
                    wan_ip = parts[idx + 1]
                except (ValueError, IndexError):
                    pass

        connected = rx_bytes > 0
        return {'connected': connected, 'rx_bytes': rx_bytes,
                'tx_bytes': tx_bytes, 'wan_ip': wan_ip}

    except Exception as e:
        return {'connected': False, 'rx_bytes': 0, 'tx_bytes': 0,
                'wan_ip': '—', 'error': str(e)}


@app.route('/starlink/status', methods=['GET'])
def starlink_status():
    global _daily_rx, _daily_tx, _daily_reset_date

    data = get_router_data()

    # Daily data counter — reset at midnight
    today = time.strftime('%Y-%m-%d')
    if _daily_reset_date != today:
        _daily_rx = 0
        _daily_tx = 0
        _daily_reset_date = today

    _daily_rx += data.get('rx_bytes', 0)
    _daily_tx += data.get('tx_bytes', 0)

    # Read relay 8 state (Starlink power)
    try:
        import lgpio
        h = lgpio.gpiochip_open(0)
        relay_state = lgpio.gpio_read(h, 16) == 0  # GPIO16 = CH8, LOW = ON
        lgpio.gpiochip_close(h)
    except Exception:
        relay_state = False

    data['relay_on'] = relay_state
    data['daily_gb'] = round((_daily_rx + _daily_tx) / 1e9, 2)
    return jsonify(data)


@app.route('/router/reboot', methods=['POST'])
def router_reboot():
    """SSH into GL.iNet and trigger a reboot."""
    try:
        subprocess.Popen(
            ['ssh', '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ConnectTimeout=3',
                    '-o', 'BatchMode=yes',
                    f'{ROUTER_USER}@{ROUTER_IP}',
                    'reboot']
        )
        return jsonify({'status': 'router rebooting'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/router/wifi-restart', methods=['POST'])
def router_wifi_restart():
    """SSH into GL.iNet and restart the Wi-Fi radio only (faster than full reboot)."""
    try:
        subprocess.Popen(
            ['ssh', '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ConnectTimeout=3',
                    '-o', 'BatchMode=yes',
                    f'{ROUTER_USER}@{ROUTER_IP}',
                    'wifi down && sleep 2 && wifi up']
        )
        return jsonify({'status': 'wifi restarting'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/router/devices', methods=['GET'])
def router_devices():
    """SSH into GL.iNet and return list of connected devices."""
    try:
        result = subprocess.run(
            ['ssh', '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ConnectTimeout=3',
                    '-o', 'BatchMode=yes',
                    f'{ROUTER_USER}@{ROUTER_IP}',
                    'cat /tmp/dhcp.leases 2>/dev/null; arp -n 2>/dev/null'],
            capture_output=True, text=True, timeout=5
        )
        devices = []
        seen_ips = set()
        for line in result.stdout.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            # dhcp.leases format: timestamp mac ip hostname clientid
            if len(parts) >= 4 and ':' in parts[1] and parts[2].startswith('192.168.'):
                ip = parts[2]
                if ip not in seen_ips:
                    seen_ips.add(ip)
                    hostname = parts[3] if parts[3] != '*' else '—'
                    devices.append({'ip': ip, 'mac': parts[1], 'name': hostname})
            # arp format: ip (ip) at mac [ether] on br-lan
            elif len(parts) >= 4 and parts[0].startswith('192.168.') and parts[0] not in seen_ips:
                if 'incomplete' not in line:
                    seen_ips.add(parts[0])
                    mac = parts[2] if len(parts) > 2 else '—'
                    devices.append({'ip': parts[0], 'mac': mac, 'name': '—'})
        devices.sort(key=lambda d: [int(x) for x in d['ip'].split('.')])
        return jsonify({'devices': devices, 'count': len(devices)})
    except Exception as e:
        return jsonify({'error': str(e), 'devices': [], 'count': 0}), 500
