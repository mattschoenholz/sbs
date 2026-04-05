#!/usr/bin/env python3
"""
renogy_signalk.py
Talks directly to the Renogy BT-2 via BLE using bleak.
No renogybt library needed — pure Modbus over BLE GATT.
"""

import asyncio
import json
import logging
import struct
from datetime import datetime, timezone

import websockets
from bleak import BleakClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("renogy-signalk")

# ── Config ────────────────────────────────────────────────────────────────────
SIGNALK_WS_URL = "ws://localhost:3000/signalk/v1/stream?subscribe=none&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZXZpY2UiOiJyZW5vZ3ktYnQyLTY0Zjc5NzY4IiwiaWF0IjoxNzc1MzM4NzM0fQ.jRXiUQzTiAj9yFVJtXKqwFs__CBhUs5XMlMdyxyX0K8"
POLL_INTERVAL  = 10
BT2_MAC        = "C8:FD:19:67:E5:BF"
DEVICE_ALIAS   = "renogy"
BATTERY_ALIAS  = "house"

# BT-2 GATT UUIDs
WRITE_UUID  = "0000ffd1-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

# Modbus device address Renogy uses over BT-2
DEVICE_ADDR = 0xFF

# ── Modbus CRC-16 ─────────────────────────────────────────────────────────────
def crc16(data: bytes) -> bytes:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return struct.pack("<H", crc)

def make_request(start: int, count: int) -> bytes:
    frame = bytes([DEVICE_ADDR, 0x03, start >> 8, start & 0xFF, count >> 8, count & 0xFF])
    return frame + crc16(frame)

# ── Register parsing ───────────────────────────────────────────────────────────
def parse_response(data: bytearray) -> dict:
    # Response: [addr, func, byte_count, data..., crc_lo, crc_hi]
    if len(data) < 5 or data[1] != 0x03:
        raise ValueError(f"Unexpected response: {data.hex()}")
    byte_count = data[2]
    reg_bytes = data[3:3 + byte_count]
    regs = [struct.unpack(">H", reg_bytes[i:i+2])[0] for i in range(0, len(reg_bytes), 2)]

    out = {}
    if len(regs) >= 10:
        out["battery_percentage"]      = regs[0]
        out["battery_voltage"]         = regs[1] * 0.1
        out["battery_current"]         = regs[2] * 0.01
        ctrl_raw = (regs[3] >> 8) & 0xFF
        batt_raw = regs[3] & 0xFF
        out["controller_temperature"]  = ctrl_raw - 128 if ctrl_raw > 127 else ctrl_raw
        out["battery_temperature"]     = batt_raw - 128 if batt_raw > 127 else batt_raw
        out["load_voltage"]            = regs[4] * 0.1
        out["load_current"]            = regs[5] * 0.01
        out["load_power"]              = regs[6]
        out["pv_voltage"]              = regs[7] * 0.1
        out["pv_current"]              = regs[8] * 0.01
        out["pv_power"]                = regs[9]
    if len(regs) >= 20:
        out["power_generation_today"]  = regs[19] * 0.001
    if len(regs) >= 34:
        total = (regs[28] << 16) | regs[29]
        out["power_generation_total"]  = total * 0.001
    return out

# ── Signal K ──────────────────────────────────────────────────────────────────
def build_delta(values: dict) -> str:
    return json.dumps({
        "context": "vessels.self",
        "updates": [{
            "source": {"label": "renogy-bt2", "type": "device"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "values": [{"path": p, "value": v} for p, v in values.items()]
        }]
    })

def map_data(d: dict) -> dict:
    sol  = f"electrical.solar.{DEVICE_ALIAS}"
    batt = f"electrical.batteries.{BATTERY_ALIAS}"
    out  = {}
    if (v := d.get("pv_voltage"))             is not None: out[f"{sol}.panelVoltage"]           = round(v, 2)
    if (v := d.get("pv_current"))             is not None: out[f"{sol}.panelCurrent"]           = round(v, 2)
    if (v := d.get("pv_power"))               is not None: out[f"{sol}.panelPower"]             = round(v, 1)
    if (v := d.get("battery_voltage"))        is not None: out[f"{batt}.voltage"]               = round(v, 2)
    if (v := d.get("battery_current"))        is not None: out[f"{batt}.current"]               = round(v, 2)
    if (v := d.get("battery_percentage"))     is not None: out[f"{batt}.stateOfCharge"]         = round(v / 100, 3)
    if (v := d.get("controller_temperature")) is not None: out[f"{sol}.controllerTemperature"]  = v + 273.15
    if (v := d.get("battery_temperature"))    is not None: out[f"{batt}.temperature"]           = v + 273.15
    if (v := d.get("load_voltage"))           is not None: out[f"electrical.loads.dc.voltage"]  = round(v, 2)
    if (v := d.get("load_current"))           is not None: out[f"electrical.loads.dc.current"]  = round(v, 2)
    if (v := d.get("load_power"))             is not None: out[f"electrical.loads.dc.power"]    = round(v, 1)
    if (v := d.get("power_generation_today")) is not None: out[f"{sol}.energyToday"]            = round(v, 3)
    if (v := d.get("power_generation_total")) is not None: out[f"{sol}.energyTotal"]            = round(v, 3)
    return out

# ── BLE poll ──────────────────────────────────────────────────────────────────
async def poll_once(device) -> dict:
    response = bytearray()
    done = asyncio.Event()

    def on_notify(_handle, data: bytearray):
        response.extend(data)
        if len(response) >= 73 or (len(response) > 3 and len(response) >= 3 + response[2] + 2):
            done.set()

    async with BleakClient(device, timeout=30) as client:
        log.info(f"Connected to BT-2 ({BT2_MAC})")
        await client.start_notify(NOTIFY_UUID, on_notify)
        await client.write_gatt_char(WRITE_UUID, make_request(0x0100, 34))
        try:
            await asyncio.wait_for(done.wait(), timeout=15)
        except asyncio.TimeoutError:
            log.warning("Timeout waiting for response — trying with fewer registers")
            # Retry with just the first 10 registers (live data only)
            response.clear()
            done.clear()
            await client.write_gatt_char(WRITE_UUID, make_request(0x0100, 10))
            await asyncio.wait_for(done.wait(), timeout=10)
        await client.stop_notify(NOTIFY_UUID)

    return parse_response(response)

# ── Main loop ─────────────────────────────────────────────────────────────────
async def find_device():
    from bleak import BleakScanner
    log.info(f"Scanning for BT-2 ({BT2_MAC})...")
    device = await BleakScanner.find_device_by_address(BT2_MAC, timeout=20)
    if device is None:
        raise RuntimeError(f"BT-2 not found: {BT2_MAC}")
    log.info(f"Found: {device.name}  [{device.address}]")
    return device

async def main():
    device = await find_device()
    while True:
        try:
            async with websockets.connect(SIGNALK_WS_URL) as ws:
                await ws.recv()  # consume hello message
                log.info("Connected to Signal K")
                while True:
                    try:
                        data = await poll_once(device)
                        if data:
                            paths = map_data(data)
                            await ws.send(build_delta(paths))
                            log.info(f"Sent {len(paths)} values → Signal K  "
                                     f"(PV {data.get('pv_voltage', '?')}V "
                                     f"{data.get('pv_power', '?')}W  "
                                     f"Batt {data.get('battery_voltage', '?')}V "
                                     f"{data.get('battery_percentage', '?')}%)")
                    except websockets.exceptions.ConnectionClosed:
                        raise  # bubble up to reconnect SK
                    except Exception as e:
                        log.error(f"Poll error: {e}")
                    await asyncio.sleep(POLL_INTERVAL)
        except Exception as e:
            log.warning(f"Signal K connection lost: {e} — reconnecting in 10s")
            await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())
