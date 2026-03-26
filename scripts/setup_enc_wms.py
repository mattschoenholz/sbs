#!/usr/bin/env python3
"""
setup_enc_wms.py — Configure MapServer WMS for local NOAA S-57 ENC charts.

Run on the Raspberry Pi:
  sudo python3 setup_enc_wms.py

What this creates:
  /data/charts/enc_all.vrt       — OGR Virtual Dataset merging all ENC files
  /etc/mapserver/enc.map         — MapServer mapfile with nautical chart styling
  /etc/nginx/sites-available/default  — Updated nginx config (adds /cgi-bin/mapserv)
Then restart nginx so the WMS is live at:
  http://sailboatserver.local/cgi-bin/mapserv?map=/etc/mapserver/enc.map&
"""

import os
import glob
import json
import subprocess
import sys

ENC_DIR        = "/data/charts/noaa_enc"
VRT_PATH       = "/data/charts/enc_all.vrt"
SOUNDINGS_PATH = "/data/charts/soundings.geojson"
MAPFILE_PATH   = "/etc/mapserver/enc.map"
NGINX_CONF     = "/etc/nginx/sites-available/default"
HOST           = "sailboatserver.local"

# S-57 layers to render (S-57 object class names)
# Ordered back to front (painters algorithm)
LAYERS = [
    # ── DEPTH AREAS ─────────────────────────────────────
    # Deepest first so shallower areas paint on top
    ("DEPARE_verydeep",  "DEPARE", "POLYGON", "DRVAL1 >= 30",                    "#1b5e8a", "#1b5e8a", None),
    ("DEPARE_deep",      "DEPARE", "POLYGON", "DRVAL1 >= 20 AND DRVAL1 < 30",    "#1d7aa3", "#1d7aa3", None),
    ("DEPARE_mid",       "DEPARE", "POLYGON", "DRVAL1 >= 10 AND DRVAL1 < 20",    "#2196c0", "#2196c0", None),
    ("DEPARE_shallow",   "DEPARE", "POLYGON", "DRVAL1 >= 5  AND DRVAL1 < 10",    "#44b4d4", "#44b4d4", None),
    ("DEPARE_vshallow",  "DEPARE", "POLYGON", "DRVAL1 >= 2  AND DRVAL1 < 5",     "#72d0e8", "#72d0e8", None),
    ("DEPARE_drying",    "DEPARE", "POLYGON", "DRVAL1 >= 0  AND DRVAL1 < 2",     "#a8e6f0", "#a8e6f0", None),
    ("DEPARE_neg",       "DEPARE", "POLYGON", "DRVAL1 < 0",                      "#c8f0f8", "#c8f0f8", None),

    # ── SEABED ───────────────────────────────────────────
    ("SBDARE",           "SBDARE", "POLYGON",  None,                             "#66b3c8", "#66b3c8", None),

    # ── LAND ─────────────────────────────────────────────
    ("LNDARE",           "LNDARE", "POLYGON",  None,                             "#c8b88a", "#8a7a60", None),

    # ── INTERTIDAL / DRYING AREAS ────────────────────────
    ("DRGARE",           "DRGARE", "POLYGON",  None,                             "#b8d4aa", "#6a8a5a", None),

    # ── DEPTH CONTOURS ───────────────────────────────────
    ("DEPCNT",           "DEPCNT", "LINE",     None,                             None,      "#1a7098", "1.0"),

    # ── COASTLINES ───────────────────────────────────────
    ("COALNE",           "COALNE", "LINE",     None,                             None,      "#4a3a20", "1.5"),
    ("SLCONS",           "SLCONS", "LINE",     None,                             None,      "#604030", "1.0"),

    # ── OBSTRUCTIONS ─────────────────────────────────────
    ("WRECKS",           "WRECKS", "POINT",    None,                             "#cc3300", None,      None),
    ("OBSTRN",           "OBSTRN", "POINT",    None,                             "#cc3300", None,      None),
    ("UWTROC",           "UWTROC", "POINT",    None,                             "#cc3300", None,      None),
]


def find_enc_files():
    return sorted(glob.glob(f"{ENC_DIR}/*/ENC_ROOT/*/*.000"))


def build_soundings(enc_files):
    """Extract SOUNDG depth soundings from all ENCs into a GeoJSON point file."""
    try:
        from osgeo import ogr
    except ImportError:
        print("  WARNING: GDAL Python bindings not available — skipping soundings")
        return False

    features = []
    for path in enc_files:
        ds = ogr.Open(path)
        if not ds:
            continue
        lyr = ds.GetLayerByName('SOUNDG')
        if not lyr:
            continue
        for feat in lyr:
            geom = feat.GetGeometryRef()
            if not geom:
                continue
            for i in range(geom.GetGeometryCount()):
                pt = geom.GetGeometryRef(i)
                z = pt.GetZ()
                if z is None or z < 0:
                    continue
                depth_str = str(round(z, 1)) if z < 10 else str(int(round(z)))
                features.append({
                    'type': 'Feature',
                    'geometry': {'type': 'Point', 'coordinates': [pt.GetX(), pt.GetY()]},
                    'properties': {'DEPTH': depth_str}
                })
        ds = None

    with open(SOUNDINGS_PATH, 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f)
    return len(features)


def build_vrt(enc_files):
    """Create an OGR VRT that merges all ENC files for each S-57 layer."""
    s57_layers = list(dict.fromkeys(row[1] for row in LAYERS))  # unique, ordered

    lines = ['<OGRVRTDataSource>']
    for layer_name in s57_layers:
        lines.append(f'  <OGRVRTUnionLayer name="{layer_name}">')
        for enc_path in enc_files:
            chart_id = os.path.basename(enc_path).replace('.000', '')
            lines.append(f'    <OGRVRTLayer name="{chart_id}_{layer_name}">')
            lines.append(f'      <SrcDataSource>{enc_path}</SrcDataSource>')
            lines.append(f'      <SrcLayer>{layer_name}</SrcLayer>')
            lines.append(f'    </OGRVRTLayer>')
        lines.append(f'  </OGRVRTUnionLayer>')
    lines.append('</OGRVRTDataSource>')
    return '\n'.join(lines)


def build_mapfile(vrt_path):
    """Generate a MapServer mapfile for S-57 ENC WMS."""
    layer_blocks = []
    for (lyr_id, s57_obj, geom, where, fill, outline, width) in LAYERS:
        fill_line    = f'        COLOR {fill_rgb(fill)}\n' if fill else ''
        outline_line = f'        OUTLINECOLOR {fill_rgb(outline)}\n' if outline else ''
        width_line   = f'        WIDTH {width}\n' if width else ''

        # Symbols for point features
        symbol_line = ''
        if geom == 'POINT':
            symbol_line = '        SYMBOL "circle"\n        SIZE 6\n'
            fill_line   = f'        COLOR {fill_rgb(fill)}\n' if fill else '        COLOR 200 50 0\n'

        where_clause = f'\n    FILTER ({where})' if where else ''
        layer_blocks.append(f"""  LAYER
    NAME "{lyr_id}"
    TYPE {geom}
    STATUS ON
    CONNECTIONTYPE OGR
    CONNECTION "{vrt_path}"
    DATA "{s57_obj}"{where_clause}
    PROJECTION
      "init=epsg:4326"
    END
    CLASS
      STYLE
{fill_line}{outline_line}{width_line}{symbol_line}      END
    END
  END""")

    layers_str = '\n'.join(layer_blocks)

    soundg_layer = f"""  LAYER
    NAME "SOUNDG"
    TYPE POINT
    STATUS ON
    CONNECTIONTYPE OGR
    CONNECTION "{SOUNDINGS_PATH}"
    PROJECTION
      "init=epsg:4326"
    END
    MINSCALEDENOM 0
    MAXSCALEDENOM 200000
    LABELITEM "DEPTH"
    CLASS
      LABEL
        TYPE BITMAP
        SIZE TINY
        COLOR 25 140 180
        OUTLINECOLOR 13 33 54
        OUTLINEWIDTH 2
        FORCE FALSE
        MINDISTANCE 15
        BUFFER 2
      END
    END
  END"""

    return f"""# MapServer mapfile for NOAA S-57 Electronic Navigational Charts
# Generated by setup_enc_wms.py — edit carefully

MAP
  NAME "NOAA_ENC"
  STATUS ON
  SIZE 512 512
  EXTENT -124.8 46.5 -121.0 49.5
  UNITS DD

  PROJECTION
    "init=epsg:4326"
  END

  WEB
    IMAGEPATH "/tmp/"
    IMAGEURL "/tmp/"
    METADATA
      WMS_TITLE "NOAA ENC — PNW"
      WMS_ONLINERESOURCE "http://{HOST}/cgi-bin/mapserv?map={MAPFILE_PATH}&"
      WMS_ENABLE_REQUEST "*"
      WMS_SRS "EPSG:4326 EPSG:3857 EPSG:900913 CRS:84"
      WMS_FEATURE_INFO_MIME_TYPE "text/plain"
      OWS_TITLE "NOAA ENC"
    END
  END

  SYMBOL
    NAME "circle"
    TYPE ellipse
    POINTS
      1 1
    END
    FILLED TRUE
  END

{layers_str}

{soundg_layer}

END
"""


def fill_rgb(hex_color):
    """Convert #rrggbb to 'R G B' for MapServer."""
    if not hex_color or not hex_color.startswith('#'):
        return '0 0 0'
    h = hex_color.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f'{r} {g} {b}'


def update_nginx(nginx_conf):
    """Add /cgi-bin/mapserv location to the nginx default site config."""
    with open(nginx_conf, 'r') as f:
        content = f.read()

    cgi_block = """
    # MapServer WMS for local NOAA ENC charts
    location /cgi-bin/mapserv {
        fastcgi_pass unix:/var/run/fcgiwrap.socket;
        fastcgi_param SCRIPT_FILENAME /usr/bin/mapserv;
        fastcgi_param QUERY_STRING    $query_string;
        fastcgi_param REQUEST_METHOD  $request_method;
        fastcgi_param CONTENT_TYPE    $content_type;
        fastcgi_param CONTENT_LENGTH  $content_length;
        include fastcgi_params;
        add_header Access-Control-Allow-Origin "*";
    }
"""
    if '/cgi-bin/mapserv' in content:
        print("  nginx already has /cgi-bin/mapserv — skipping")
        return False

    # Insert before the closing server block
    insert_before = '\n}'
    idx = content.rfind(insert_before)
    if idx == -1:
        print("  WARNING: Could not find closing } in nginx config — appending")
        content += cgi_block
    else:
        content = content[:idx] + cgi_block + content[idx:]

    with open(nginx_conf, 'w') as f:
        f.write(content)
    return True


def main():
    enc_files = find_enc_files()
    if not enc_files:
        print("ERROR: No .000 files found in", ENC_DIR)
        sys.exit(1)

    print(f"Found {len(enc_files)} ENC files")

    # 1. Build OGR VRT
    print(f"Writing OGR VRT → {VRT_PATH}")
    vrt_content = build_vrt(enc_files)
    with open(VRT_PATH, 'w') as f:
        f.write(vrt_content)

    # 1b. Extract depth soundings to GeoJSON
    print(f"Extracting SOUNDG soundings → {SOUNDINGS_PATH}")
    n = build_soundings(enc_files)
    if n:
        print(f"  {n} individual soundings written")

    # 2. Build mapfile
    os.makedirs("/etc/mapserver", exist_ok=True)
    print(f"Writing MapServer mapfile → {MAPFILE_PATH}")
    mapfile_content = build_mapfile(VRT_PATH)
    with open(MAPFILE_PATH, 'w') as f:
        f.write(mapfile_content)

    # 3. Update nginx config
    print(f"Updating nginx config → {NGINX_CONF}")
    changed = update_nginx(NGINX_CONF)

    # 4. Test mapfile
    print("\nTesting mapfile syntax...")
    result = subprocess.run(
        ['/usr/bin/mapserv', '-nh', f'QUERY_STRING=SERVICE=WMS&REQUEST=GetCapabilities&map={MAPFILE_PATH}'],
        capture_output=True, text=True, timeout=15
    )
    if result.returncode == 0 and 'WMS_Capabilities' in result.stdout:
        print("  ✓ MapServer WMS GetCapabilities OK")
    else:
        # GetCapabilities failure may also just be missing env var
        print(f"  Mapfile syntax check: returncode={result.returncode}")
        if result.stderr:
            print("  stderr:", result.stderr[:300])

    # 5. Restart nginx
    if changed:
        print("\nRestarting nginx...")
        subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
        print("  nginx reloaded")

    print(f"""
=================================================
  WMS setup complete!

  WMS endpoint:
  http://{HOST}/cgi-bin/mapserv?map={MAPFILE_PATH}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=DEPARE_shallow,LNDARE,DEPCNT,COALNE&SRS=EPSG:4326&BBOX=-122.4,47.5,-122.2,47.7&WIDTH=512&HEIGHT=512&FORMAT=image/png

  In the portal, tap the chart button until it shows 'LOCAL' to use local ENCs.
=================================================
""")


if __name__ == '__main__':
    if os.geteuid() != 0:
        print("Re-running with sudo...")
        os.execvp('sudo', ['sudo', 'python3'] + sys.argv)
    main()
