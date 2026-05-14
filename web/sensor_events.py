"""
sensor_events.py — Flask blueprint for sensor health events.

Plug into relay_server.py with one line at app-create time:

    from sensor_events import bp as sensor_events_bp
    app.register_blueprint(sensor_events_bp)

Adds three routes (all under the existing nginx /api prefix):

    POST /sensor_event       — node_id, event_type, severity, message, timestamp
    GET  /sensor_status      — latest event per node_id
    GET  /sensor_events      — last N events (?limit=100, default 100)

Persists to a SQLite file at SENSOR_EVENTS_DB. The schema is dead simple —
single table, no migrations needed for v1. Older rows can be pruned by cron
if size becomes a concern; the file is small (~100 bytes/event).

The sv-esperanza-wind ESP32 POSTs here every time its computed health state
changes (see sv_esperanza_wind.yaml — interval block). The Helm UI polls
GET /api/sensor_status every 5 s (see web/js/sbs-sensor-toast.js).
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any

from flask import Blueprint, jsonify, request

DB_PATH = os.environ.get("SENSOR_EVENTS_DB", "/var/lib/sailboat/sensor_events.db")
ALLOWED_SEVERITIES = {"info", "ok", "warn", "fault"}

bp = Blueprint("sensor_events", __name__)
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id    TEXT    NOT NULL,
            event_type TEXT    NOT NULL,
            severity   TEXT    NOT NULL,
            message    TEXT,
            ts         REAL    NOT NULL,
            received   REAL    NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS sensor_events_node_ts "
        "ON sensor_events(node_id, ts DESC)"
    )
    conn.commit()
    return conn


@bp.route("/sensor_event", methods=["POST"])
def post_sensor_event():
    """Accept a sensor health event from an ESP32 node."""
    if not request.is_json:
        return jsonify(error="json required"), 400
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    node_id    = (payload.get("node_id") or "").strip()
    event_type = (payload.get("event_type") or "").strip()
    severity   = (payload.get("severity") or "").strip()
    message    = payload.get("message") or ""
    ts         = payload.get("timestamp")

    if not node_id or not event_type or severity not in ALLOWED_SEVERITIES:
        return jsonify(
            error="missing/invalid fields",
            required=["node_id", "event_type", "severity"],
            allowed_severities=sorted(ALLOWED_SEVERITIES),
        ), 400
    try:
        ts_f = float(ts) if ts is not None else time.time()
    except (TypeError, ValueError):
        return jsonify(error="timestamp must be a number"), 400

    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO sensor_events (node_id, event_type, severity, message, ts, received) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (node_id, event_type, severity, str(message)[:512], ts_f, time.time()),
        )
        conn.commit()
    return jsonify(ok=True), 201


@bp.route("/sensor_status", methods=["GET"])
def get_sensor_status():
    """Latest event per node_id — what the Helm UI polls."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT node_id, event_type, severity, message, ts
            FROM sensor_events
            WHERE id IN (
                SELECT MAX(id) FROM sensor_events GROUP BY node_id
            )
            ORDER BY node_id
            """
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route("/sensor_events", methods=["GET"])
def get_sensor_events():
    """Last N events across all nodes (debug / log view)."""
    try:
        limit = max(1, min(int(request.args.get("limit", 100)), 1000))
    except (TypeError, ValueError):
        limit = 100
    node_id = request.args.get("node_id")
    with _connect() as conn:
        if node_id:
            rows = conn.execute(
                "SELECT node_id, event_type, severity, message, ts, received "
                "FROM sensor_events WHERE node_id = ? ORDER BY id DESC LIMIT ?",
                (node_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT node_id, event_type, severity, message, ts, received "
                "FROM sensor_events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return jsonify([dict(r) for r in rows])
