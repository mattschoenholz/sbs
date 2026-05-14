# Wind sensor UI — integration patch

The wind sensor adds three new files; integrating them into the existing
Helm/Portal pages requires three small edits to existing files. None of the
edits change behaviour for callers who haven't yet adopted them.

## 1. `web/helm.html` — add the toast container, status dot, and script tags

In the `<head>` block, after the existing `helm.css` link:

```html
<script defer src="js/sbs-sensor-toast.js"></script>
<script defer src="js/sbs-wind-controls.js"></script>
```

In the wind tile section (around `id="tile-twd"` / `id="tile-tws"`), add a
status dot inside the apparent-wind tile labels (or alongside the existing
`<wind-gauge>` if you prefer a single indicator). Example for the AWA tile:

```html
<div class="helm-tile" id="tile-awa">
  <span class="h-label">AWA <sensor-status-dot node-id="sv-esperanza-wind"></sensor-status-dot></span>
  <span class="h-value" id="v-awa">---</span>
  <span class="h-unit">°</span>
</div>
```

The toast container auto-mounts at the bottom-right of the page on
DOMContentLoaded; nothing else to add there.

## 2. `web/index.html` (Portal — Nav Station settings) — add the cal controls

Inside the Nav Station settings drawer (or wherever existing sensor settings
live), drop in:

```html
<wind-cal-controls></wind-cal-controls>
```

Same two `<script defer>` tags as above need to be present.

## 3. `relay_server.py` — register the blueprint and add three wind proxy routes

After `app = Flask(__name__)`:

```python
from sensor_events import bp as sensor_events_bp
app.register_blueprint(sensor_events_bp)
```

Add the three wind calibration proxies (the ESP32 ESPHome services are
addressable via the native API; the simplest cross-origin path is a server-side
proxy). Pseudocode:

```python
WIND_NODE_HOST = "sv-esperanza-wind.local"

@app.route("/wind/<service>", methods=["POST"])
def wind_cal(service):
    if service not in ("calibrate_direction", "set_heading_zero", "reset_to_factory"):
        return jsonify(error="unknown service"), 400
    # Simplest: shell out to esphome-cli, or use aioesphomeapi.
    # See sv_esperanza_wind.yaml — these are the three services exposed.
    ...
```

(For v1, Matt may prefer to call the ESPHome services directly from Home
Assistant — both are valid; the proxy is just the path the JS controls
expect by default.)
