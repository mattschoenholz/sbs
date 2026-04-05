#!/usr/bin/env python3
"""
tp22_nmea.py
Reads navigation state from Signal K and sends APB + RMB sentences
to the Simrad TP22 autotiller via /dev/ttyOP_tp22 (UART4) at 1 Hz.

Two modes:
  route   — SK has an active nextPoint; bearing/XTE are computed from SK data.
  manual  — Portal engaged autopilot on a heading (no waypoint needed).
             Heading adjustable via ±1°/±10° buttons in helm UI.

Priority: route > manual > silence.

HTTP API (port 5002, localhost only):
  GET  /state          → {mode, heading, engaged}
  POST /engage         → body {heading?: float}  (engage manual mode)
  POST /adjust         → body {delta: float}      (±1 / ±10)
  POST /disengage      → stop manual mode
"""

import asyncio
import json
import logging
import math

import serial
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tp22-nmea")

# ── Config ─────────────────────────────────────────────────────────────────────
SIGNALK_WS_URL = (
    "ws://localhost:3000/signalk/v1/stream?subscribe=none"
    "&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJkZXZpY2UiOiJyZW5vZ3ktYnQyLTY0Zjc5NzY4IiwiaWF0IjoxNzc1MzM4NzM0fQ"
    ".jRXiUQzTiAj9yFVJtXKqwFs__CBhUs5XMlMdyxyX0K8"
)
SERIAL_PORT = "/dev/ttyOP_tp22"
BAUD_RATE   = 4800
UPDATE_HZ   = 1.0
HTTP_PORT   = 5002

SK_PATHS = [
    "navigation.position",
    "navigation.headingTrue",
    "navigation.headingMagnetic",
    "navigation.magneticVariation",
    "navigation.courseOverGroundTrue",
    "navigation.speedOverGround",
    "navigation.courseGreatCircle.nextPoint.position",
    "navigation.courseGreatCircle.nextPoint.distance",
    "navigation.courseGreatCircle.bearingTrackTrue",
    "navigation.courseGreatCircle.crossTrackError",
    "navigation.course.nextPoint.position",
    "navigation.course.nextPoint.distance",
    "navigation.course.bearingTrackTrue",
    "navigation.course.crossTrackError",
]

# ── NMEA helpers ───────────────────────────────────────────────────────────────
def cksum(s: str) -> str:
    cs = 0
    for c in s:
        cs ^= ord(c)
    return f"{cs:02X}"

def fmt_lat(d: float) -> str:
    deg = int(abs(d))
    mins = (abs(d) - deg) * 60
    return f"{deg:02d}{mins:07.4f},{'N' if d >= 0 else 'S'}"

def fmt_lon(d: float) -> str:
    deg = int(abs(d))
    mins = (abs(d) - deg) * 60
    return f"{deg:03d}{mins:07.4f},{'E' if d >= 0 else 'W'}"

def build_apb(bearing_t: float, wpt_id: str, xte: float = 0.0, xte_dir: str = "R") -> bytes:
    body = (
        f"GPAPB,A,A,{xte:.2f},{xte_dir},N,V,V,"
        f"{bearing_t:.1f},T,{wpt_id},"
        f"{bearing_t:.1f},T,{bearing_t:.1f},T"
    )
    return f"${body}*{cksum(body)}\r\n".encode()

def build_rmb(
    bearing_t: float, wpt_lat: float, wpt_lon: float, wpt_id: str,
    dist_nm: float, sog: float = 0.0, xte: float = 0.0, xte_dir: str = "R",
) -> bytes:
    body = (
        f"GPRMB,A,{xte:.2f},{xte_dir},,{wpt_id},"
        f"{fmt_lat(wpt_lat)},{fmt_lon(wpt_lon)},"
        f"{dist_nm:.2f},{bearing_t:.1f},{sog:.1f},V"
    )
    return f"${body}*{cksum(body)}\r\n".encode()

# ── Bearing / distance math ────────────────────────────────────────────────────
def bearing_distance(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlon = lo2 - lo1
    x = math.sin(dlon) * math.cos(la2)
    y = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
    brg = (math.degrees(math.atan2(x, y)) + 360) % 360
    dlat = la2 - la1
    a = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    dist_nm = math.degrees(2 * math.asin(math.sqrt(a))) * 60
    return brg, dist_nm

def virtual_waypoint(lat, lon, bearing_t, dist_nm=10.0):
    """Return a position dist_nm away on bearing_t from lat/lon."""
    d = math.radians(dist_nm / 60)
    b = math.radians(bearing_t)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(
        math.sin(b) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)

# ── Shared state ───────────────────────────────────────────────────────────────
state = {
    "pos":          None,
    "sog":          0.0,
    "hdg_true":     None,   # radians
    "hdg_mag":      None,   # radians
    "mag_var":      None,   # radians
    "next_pos":     None,
    "next_dist":    None,
    "bearing_true": None,   # radians
    "xte":          None,   # metres
}

# Manual heading mode
manual = {
    "enabled": False,
    "heading": None,   # degrees true
}

def apply_update(path: str, value):
    if path == "navigation.position":
        state["pos"] = value
    elif path == "navigation.speedOverGround":
        state["sog"] = value or 0.0
    elif path == "navigation.headingTrue":
        state["hdg_true"] = value
    elif path == "navigation.headingMagnetic":
        state["hdg_mag"] = value
    elif path == "navigation.magneticVariation":
        state["mag_var"] = value
    elif path in ("navigation.courseGreatCircle.nextPoint.position",
                  "navigation.course.nextPoint.position"):
        state["next_pos"] = value
    elif path in ("navigation.courseGreatCircle.nextPoint.distance",
                  "navigation.course.nextPoint.distance"):
        state["next_dist"] = value
    elif path in ("navigation.courseGreatCircle.bearingTrackTrue",
                  "navigation.course.bearingTrackTrue"):
        state["bearing_true"] = value
    elif path in ("navigation.courseGreatCircle.crossTrackError",
                  "navigation.course.crossTrackError"):
        state["xte"] = value

def current_heading_true() -> float | None:
    """Best estimate of current true heading in degrees."""
    if state["hdg_true"] is not None:
        return math.degrees(state["hdg_true"]) % 360
    if state["hdg_mag"] is not None:
        var = math.degrees(state["mag_var"]) if state["mag_var"] else 0.0
        return (math.degrees(state["hdg_mag"]) + var) % 360
    if state["sog"] and state.get("cog_true"):
        return math.degrees(state["cog_true"]) % 360
    return None

def get_sentences():
    """Return (apb, rmb) bytes for whichever mode is active, or None."""
    pos = state["pos"]
    sog_kts = state["sog"] * 1.94384

    # ── Route mode (SK has an active waypoint) ──
    next_pos = state["next_pos"]
    if pos and next_pos:
        if state["bearing_true"] is not None:
            bearing = math.degrees(state["bearing_true"]) % 360
        else:
            bearing, _ = bearing_distance(
                pos["latitude"], pos["longitude"],
                next_pos["latitude"], next_pos["longitude"],
            )
        dist_nm = (state["next_dist"] / 1852.0) if state["next_dist"] else \
                  bearing_distance(pos["latitude"], pos["longitude"],
                                   next_pos["latitude"], next_pos["longitude"])[1]
        xte_nm  = abs(state["xte"]) / 1852.0 if state["xte"] else 0.0
        xte_dir = ("R" if (state["xte"] or 0) >= 0 else "L")
        return (
            build_apb(bearing, "NEXTWPT", xte_nm, xte_dir),
            build_rmb(bearing, next_pos["latitude"], next_pos["longitude"],
                      "NEXTWPT", dist_nm, sog_kts, xte_nm, xte_dir),
        )

    # ── Manual heading mode ──
    if manual["enabled"] and manual["heading"] is not None and pos:
        bearing = manual["heading"]
        wpt_lat, wpt_lon = virtual_waypoint(
            pos["latitude"], pos["longitude"], bearing, dist_nm=10.0
        )
        return (
            build_apb(bearing, "HELM", 0.0, "R"),
            build_rmb(bearing, wpt_lat, wpt_lon, "HELM", 10.0, sog_kts),
        )

    return None

# ── Minimal async HTTP server ──────────────────────────────────────────────────
async def http_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        raw = await asyncio.wait_for(reader.read(2048), timeout=3)
        text = raw.decode(errors="replace")
        lines = text.split("\r\n")
        if not lines:
            return
        parts = lines[0].split(" ")
        method = parts[0] if len(parts) > 0 else "GET"
        path   = parts[1].split("?")[0] if len(parts) > 1 else "/"

        body_str = text.split("\r\n\r\n", 1)[-1] if "\r\n\r\n" in text else ""
        try:
            body = json.loads(body_str) if body_str.strip() else {}
        except Exception:
            body = {}

        # ── Route handlers ──
        if method == "GET" and path == "/state":
            mode = "route" if state["next_pos"] else ("manual" if manual["enabled"] else "inactive")
            resp = json.dumps({
                "mode":    mode,
                "engaged": manual["enabled"] or state["next_pos"] is not None,
                "heading": manual["heading"],
            })
            _write_http(writer, 200, resp)

        elif method == "POST" and path == "/engage":
            hdg = body.get("heading")
            if hdg is None:
                hdg = current_heading_true()
            if hdg is None:
                _write_http(writer, 400, '{"error":"no heading available"}')
                return
            manual["enabled"] = True
            manual["heading"]  = float(hdg) % 360
            log.info(f"Manual heading engaged: {manual['heading']:.1f}°T")
            _write_http(writer, 200, json.dumps({"heading": manual["heading"]}))

        elif method == "POST" and path == "/adjust":
            delta = float(body.get("delta", 0))
            if not manual["enabled"]:
                _write_http(writer, 400, '{"error":"not engaged"}')
                return
            manual["heading"] = ((manual["heading"] or 0) + delta) % 360
            log.info(f"Manual heading adjusted to {manual['heading']:.1f}°T")
            _write_http(writer, 200, json.dumps({"heading": manual["heading"]}))

        elif method == "POST" and path == "/disengage":
            manual["enabled"] = False
            log.info("Manual heading disengaged")
            _write_http(writer, 200, '{"ok":true}')

        else:
            _write_http(writer, 404, '{"error":"not found"}')

    except Exception as e:
        log.warning(f"HTTP handler error: {e}")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

def _write_http(writer, status: int, body: str):
    phrase = {200: "OK", 400: "Bad Request", 404: "Not Found"}.get(status, "Error")
    response = (
        f"HTTP/1.1 {status} {phrase}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Access-Control-Allow-Origin: *\r\n"
        f"\r\n"
        f"{body}"
    )
    writer.write(response.encode())

# ── Main loop ──────────────────────────────────────────────────────────────────
def make_subscribe():
    return json.dumps({
        "context": "vessels.self",
        "subscribe": [{"path": p, "period": 1000} for p in SK_PATHS],
    })

async def main():
    ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    log.info(f"Opened {SERIAL_PORT} at {BAUD_RATE} baud")

    http_server = await asyncio.start_server(http_handler, "127.0.0.1", HTTP_PORT)
    log.info(f"HTTP API listening on port {HTTP_PORT}")

    async with http_server:
        while True:
            try:
                async with websockets.connect(SIGNALK_WS_URL) as ws:
                    await ws.recv()  # consume hello
                    await ws.send(make_subscribe())
                    log.info("Connected to Signal K, subscribed to navigation paths")

                    last_send = 0.0
                    while True:
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                            data = json.loads(msg)
                            for update in data.get("updates", []):
                                for v in update.get("values", []):
                                    apply_update(v["path"], v["value"])
                        except asyncio.TimeoutError:
                            pass
                        except websockets.exceptions.ConnectionClosed:
                            raise

                        now = asyncio.get_event_loop().time()
                        if now - last_send >= UPDATE_HZ:
                            sentences = get_sentences()
                            if sentences:
                                apb, rmb = sentences
                                ser.write(apb)
                                ser.write(rmb)
                                log.debug(f"→ TP22: {apb.decode().strip()}")
                            last_send = now

            except Exception as e:
                log.warning(f"Signal K connection lost: {e} — reconnecting in 10s")
                await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())
