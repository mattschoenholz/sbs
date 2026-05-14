"""
test_sensor_events.py — unittest suite for the sensor_events Flask blueprint.

Skipped automatically if Flask isn't available on the host (the boat Pi has it;
bearclaw may not). On the boat:
    cd web && python3 -m unittest -v test_sensor_events
"""

import os
import tempfile
import time
import unittest

try:
    import flask  # noqa: F401
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False


@unittest.skipUnless(HAS_FLASK, "flask not installed on this host")
class SensorEventsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.tmp.close()
        os.environ["SENSOR_EVENTS_DB"] = self.tmp.name
        # Re-import to pick up the env var.
        import importlib
        import sensor_events
        importlib.reload(sensor_events)
        from flask import Flask
        self.app = Flask(__name__)
        self.app.register_blueprint(sensor_events.bp)
        self.client = self.app.test_client()

    def tearDown(self):
        os.unlink(self.tmp.name)

    def _post(self, **kwargs):
        return self.client.post("/sensor_event", json=kwargs)

    def test_post_valid_event(self):
        r = self._post(
            node_id="sv-esperanza-wind",
            event_type="health",
            severity="warn",
            message="vane_frozen_with_wind",
            timestamp=time.time(),
        )
        self.assertEqual(r.status_code, 201, r.data)

    def test_post_rejects_unknown_severity(self):
        r = self._post(node_id="x", event_type="health", severity="explode")
        self.assertEqual(r.status_code, 400)

    def test_post_rejects_missing_fields(self):
        r = self._post(node_id="x", severity="ok")
        self.assertEqual(r.status_code, 400)

    def test_status_returns_latest_per_node(self):
        self._post(node_id="a", event_type="health", severity="ok", timestamp=1)
        self._post(node_id="a", event_type="health", severity="warn", timestamp=2)
        self._post(node_id="b", event_type="health", severity="fault", timestamp=3)
        r = self.client.get("/sensor_status")
        self.assertEqual(r.status_code, 200)
        rows = {row["node_id"]: row for row in r.get_json()}
        self.assertEqual(rows["a"]["severity"], "warn")
        self.assertEqual(rows["b"]["severity"], "fault")

    def test_events_log_returns_recent(self):
        for i in range(5):
            self._post(
                node_id="a", event_type="health", severity="ok", timestamp=i
            )
        r = self.client.get("/sensor_events?limit=3")
        self.assertEqual(len(r.get_json()), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
