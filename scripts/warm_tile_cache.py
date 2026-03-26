#!/usr/bin/env python3
"""
Pre-warm nginx tile cache for MapServer WMS charts.

Generates tile requests that EXACTLY match Leaflet's URL format so that
browser tile requests hit the nginx fastcgi_cache instead of re-rendering.

Tile coverage:
  - Zoom 1-12 : Wide PNW area  (lat 36-58, lon -138 to -120) — fast, ~80k tiles
  - Zoom 13-15: ENC data bounds (lat 45.8-49.1, lon -124.7 to -122.3) — ~150k tiles

Run: python3 warm_tile_cache.py [--max-zoom 15] [--workers 4] [--log /tmp/warm.log]
Check: tail -f /tmp/warm_tiles.log
"""

import math
import sys
import time
import argparse
import concurrent.futures
import urllib.request
import urllib.error

# ── WMS constants (must match sbs-chart.js exactly) ──────────────────────────
LAYERS = (
    "DEPARE_verydeep,DEPARE_deep,DEPARE_mid,DEPARE_shallow,DEPARE_vshallow,"
    "DEPARE_drying,DEPARE_neg,SBDARE,LNDARE,DRGARE,DEPCNT,COALNE,SLCONS,"
    "WRECKS,OBSTRN,UWTROC,SOUNDG"
)
# URL-encoded layers string (Leaflet uses encodeURIComponent on the value)
LAYERS_ENC = LAYERS.replace(",", "%2C")

# Static URL prefix — matches Leaflet's getParamString output exactly
# Order: service, request, layers, styles, format, transparent, version, width, height, srs
# (width/height set in initialize; srs set in onAdd — as seen in Leaflet source)
URL_PREFIX = (
    "http://localhost/cgi-bin/mapserv"
    "?service=WMS"
    "&request=GetMap"
    f"&layers={LAYERS_ENC}"
    "&styles="
    "&format=image%2Fpng"
    "&transparent=true"
    "&version=1.1.1"
    "&width=256"
    "&height=256"
    "&srs=EPSG%3A3857"
    "&bbox="
)

# ── Geographic bounds ─────────────────────────────────────────────────────────
# ENC data coverage (from enc_merged.gpkg)
ENC_BOUNDS = (-124.656917, 45.861477, -122.292914, 49.004167)   # xmin,ymin,xmax,ymax

# Wide area — ~500nm from Seattle (covers all likely PNW sailing waters)
WIDE_BOUNDS = (-138.0, 36.0, -120.0, 58.0)

# ── Earth constants (must match Leaflet's R = 6378137 exactly) ───────────────
R = 6378137.0

# Leaflet EPSG:3857 Transformation coefficients:
#   transformation: ht(_a = 0.5/(PI*R), _b = 0.5, _c = -0.5/(PI*R), _d = 0.5)
# untransform: x = (px/scale - _b) / _a,  y = (py/scale - _d) / _c
_LEAFLET_A =  0.5 / (math.pi * R)   # positive
_LEAFLET_C = -0.5 / (math.pi * R)   # negative


def tile_bbox(z: int, x: int, y: int) -> tuple:
    """
    Compute EPSG:3857 bbox using Leaflet's EXACT code path:
      untransform(pt, scale) → (pt.x/scale - _b) / _a,  (pt.y/scale - _d) / _c
    where _a=0.5/(π*R), _b=0.5, _c=-0.5/(π*R), _d=0.5, scale=256*2^z.

    Using division (not multiplication) matches Leaflet bit-for-bit,
    which is required for nginx fastcgi_cache_key ($request_uri) hits.
    The subsequent unproject→project round-trip is an identity, so we skip it.
    """
    scale = 256.0 * (2 ** z)
    nw_px = x       * 256.0
    se_px = (x + 1) * 256.0
    nw_py = y       * 256.0
    se_py = (y + 1) * 256.0

    xmin = (nw_px / scale - 0.5) / _LEAFLET_A   # west edge (NW x)
    xmax = (se_px / scale - 0.5) / _LEAFLET_A   # east edge (SE x)
    ymax = (nw_py / scale - 0.5) / _LEAFLET_C   # north edge (NW y) — _c is negative
    ymin = (se_py / scale - 0.5) / _LEAFLET_C   # south edge (SE y)
    return xmin, ymin, xmax, ymax


def lon_to_x(lon: float, z: int) -> int:
    return int((lon + 180.0) / 360.0 * (2 ** z))


def lat_to_y(lat: float, z: int) -> int:
    lat_r = math.radians(lat)
    n = 2 ** z
    return int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)


def tiles_for_bounds(bounds: tuple, z: int):
    """Yield all (z, x, y) tile coords covering the given WGS84 bounds."""
    lon_min, lat_min, lon_max, lat_max = bounds
    x0 = lon_to_x(lon_min, z)
    x1 = lon_to_x(lon_max, z)
    y0 = lat_to_y(lat_max, z)  # north → smaller y
    y1 = lat_to_y(lat_min, z)  # south → larger y
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield z, x, y


def make_url(z: int, x: int, y: int) -> str:
    xmin, ymin, xmax, ymax = tile_bbox(z, x, y)
    return f"{URL_PREFIX}{xmin},{ymin},{xmax},{ymax}"


def fetch_tile(args):
    z, x, y = args
    url = make_url(z, x, y)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TileWarmer/1.0"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = resp.read()
            status = resp.getheader("X-Cache-Status", "?")
            return z, x, y, len(data), status, None
    except Exception as e:
        return z, x, y, 0, "ERR", str(e)


def count_tiles(zoom_levels, wide_zooms, enc_zooms):
    total = 0
    for z in zoom_levels:
        bounds = WIDE_BOUNDS if z <= wide_zooms else ENC_BOUNDS
        count = sum(1 for _ in tiles_for_bounds(bounds, z))
        total += count
    return total


def main():
    parser = argparse.ArgumentParser(description="Pre-warm MapServer WMS tile cache")
    parser.add_argument("--max-zoom", type=int, default=15,
                        help="Maximum zoom level to pre-warm (default: 15)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel workers (default: 4, matches fcgiwrap)")
    parser.add_argument("--log", default="/tmp/warm_tiles.log",
                        help="Log file path (default: /tmp/warm_tiles.log)")
    parser.add_argument("--test", action="store_true",
                        help="Test URL format against known tile from nginx log and exit")
    args = parser.parse_args()

    if args.test:
        # Verify our bbox formula against the known tile from nginx access.log:
        # Tile z=6, x=12 has xmin=-12523442.714243278 (verified against Leaflet)
        xmin, ymin, xmax, ymax = tile_bbox(6, 12, 20)
        print(f"Test tile z=6 x=12 y=20:")
        print(f"  xmin = {xmin}")
        print(f"  ymin = {ymin}")
        print(f"  xmax = {xmax}")
        print(f"  ymax = {ymax}")
        print(f"Expected xmin: -12523442.714243278")
        print(f"Expected ymax:  7514065.628545967")
        print(f"Match xmin: {abs(xmin - (-12523442.714243278)) < 1e-3}")
        print(f"Match ymax: {abs(ymax - 7514065.628545967) < 1e-3}")
        print()
        print(f"Sample URL:\n  {make_url(6, 12, 20)}")
        return

    # Split: wide area for zoom ≤ 12, ENC bounds for zoom 13+
    WIDE_MAX_ZOOM = 12
    zoom_levels = list(range(1, args.max_zoom + 1))

    # Pre-count tiles
    print("Counting tiles...", flush=True)
    tile_list = []
    zoom_counts = {}
    for z in zoom_levels:
        bounds = WIDE_BOUNDS if z <= WIDE_MAX_ZOOM else ENC_BOUNDS
        ztiles = list(tiles_for_bounds(bounds, z))
        zoom_counts[z] = len(ztiles)
        tile_list.extend(ztiles)

    total = len(tile_list)
    print(f"\nPre-warming {total:,} tiles (zoom 1-{args.max_zoom}, {args.workers} workers)")
    print(f"Wide area coverage (zoom 1-{WIDE_MAX_ZOOM}): {WIDE_BOUNDS}")
    print(f"ENC data coverage  (zoom {WIDE_MAX_ZOOM+1}-{args.max_zoom}): {ENC_BOUNDS}")
    print(f"Zoom breakdown:")
    for z in zoom_levels:
        bounds_label = "WIDE" if z <= WIDE_MAX_ZOOM else "ENC "
        print(f"  z{z:2d} ({bounds_label}): {zoom_counts[z]:6,} tiles")
    if total > 50000:
        est_min = total / args.workers / 10  # ~10 tiles/sec per worker pessimistic
        print(f"\nEstimated time: ~{est_min/60:.0f} hours (runs in background, check {args.log})")
    print(f"\nLogging to: {args.log}")
    print("Starting... (Ctrl-C to stop, already-cached tiles are instant)\n", flush=True)

    done = 0
    hit = 0
    miss = 0
    errors = 0
    start = time.time()

    with open(args.log, "w") as logf:
        logf.write(f"TileWarmer started: {total} tiles, zoom 1-{args.max_zoom}\n")
        logf.flush()

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(fetch_tile, t): t for t in tile_list}
            for future in concurrent.futures.as_completed(futures):
                z, x, y, size, status, err = future.result()
                done += 1
                if err:
                    errors += 1
                elif "HIT" in status:
                    hit += 1
                else:
                    miss += 1

                if done % 500 == 0 or done == total:
                    elapsed = time.time() - start
                    rate = done / elapsed if elapsed > 0 else 0
                    eta_s = (total - done) / rate if rate > 0 else 0
                    msg = (
                        f"  {done:7,}/{total:,} ({100*done/total:5.1f}%) "
                        f"| HIT={hit:,} MISS={miss:,} ERR={errors} "
                        f"| {rate:5.1f} tiles/s "
                        f"| ETA {eta_s/60:.0f}m\n"
                    )
                    sys.stdout.write(msg)
                    sys.stdout.flush()
                    logf.write(msg)
                    logf.flush()

                if err and errors <= 10:
                    logf.write(f"    ERR z={z} x={x} y={y}: {err}\n")
                    logf.flush()

    elapsed = time.time() - start
    summary = (
        f"\nDone! {total:,} tiles in {elapsed/60:.1f} minutes.\n"
        f"Cache hits: {hit:,} | New tiles rendered: {miss:,} | Errors: {errors}\n"
    )
    print(summary)
    with open(args.log, "a") as logf:
        logf.write(summary)


if __name__ == "__main__":
    main()
