#!/usr/bin/env python3
"""
make_offline_tiles.py — Download NOAA nautical chart tiles for PNW and
save as an MBTiles SQLite file that SignalK charts plugin can serve.

Usage:
  python3 make_offline_tiles.py [--min-zoom 8] [--max-zoom 16]

Defaults:
  Area:  Puget Sound + San Juan Islands + Strait of Juan de Fuca
         (lat 47.0–49.5, lon –124.8 to –121.5)
  Zooms: 8–16 (roughly 12,000 tiles, ~80 MB — takes 10–20 min on Pi)

Output:
  /data/charts/pnw_noaa.mbtiles

The SignalK charts plugin (configured with chartPath=/data/charts) will
automatically detect this file and expose it via the charts API.
"""

import argparse
import math
import os
import sqlite3
import sys
import time
import urllib.request

# ── AREA DEFINITION ─────────────────────────────────────────────────────────
# Pacific Northwest: Puget Sound, San Juan Islands, Strait of Juan de Fuca,
# Hood Canal, South Sound, and outer coast approach.
REGION = {
    "name": "PNW - Puget Sound & San Juan Islands",
    "min_lat": 46.8,
    "max_lat": 49.2,
    "min_lon": -124.8,
    "max_lon": -121.5,
}

TILE_URL = "https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png"
OUTPUT    = "/data/charts/pnw_noaa.mbtiles"
DELAY_S   = 0.05   # Polite delay between tile requests (seconds)

# ── TILE MATH ────────────────────────────────────────────────────────────────
def deg2tile(lat, lon, zoom):
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y

def tile_bounds(region, zoom):
    x_min, y_max = deg2tile(region["min_lat"], region["min_lon"], zoom)
    x_max, y_min = deg2tile(region["max_lat"], region["max_lon"], zoom)
    return x_min, y_min, x_max, y_max

def count_tiles(region, min_z, max_z):
    total = 0
    for z in range(min_z, max_z + 1):
        x0, y0, x1, y1 = tile_bounds(region, z)
        total += (x1 - x0 + 1) * (y1 - y0 + 1)
    return total

# ── MBTILES ──────────────────────────────────────────────────────────────────
def init_mbtiles(path, region, min_z, max_z):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level  INTEGER,
            tile_column INTEGER,
            tile_row    INTEGER,
            tile_data   BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row);
    """)
    metadata = {
        "name":        region["name"],
        "type":        "overlay",
        "version":     "1.0",
        "description": "NOAA Official Nautical Charts — Pacific Northwest",
        "format":      "png",
        "bounds":      f"{region['min_lon']},{region['min_lat']},{region['max_lon']},{region['max_lat']}",
        "minzoom":     str(min_z),
        "maxzoom":     str(max_z),
        "center":      f"{(region['min_lon']+region['max_lon'])/2},{(region['min_lat']+region['max_lat'])/2},{min_z+2}",
    }
    for k, v in metadata.items():
        c.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", (k, v))
    conn.commit()
    return conn

def mbtiles_row(y, zoom):
    """MBTiles uses TMS tile coords (y flipped vs XYZ/slippy)."""
    return (2 ** zoom - 1) - y

# ── DOWNLOAD ─────────────────────────────────────────────────────────────────
def download_tiles(conn, region, min_z, max_z):
    c = conn.cursor()
    total   = count_tiles(region, min_z, max_z)
    done    = 0
    skipped = 0
    errors  = 0
    batch   = []

    print(f"  Area:   {region['name']}")
    print(f"  Bounds: {region['min_lat']}–{region['max_lat']}°N, {region['min_lon']}–{region['max_lon']}°E")
    print(f"  Zooms:  {min_z}–{max_z}  ({total:,} tiles)")
    print()

    headers = {"User-Agent": "SV-Esperanza/1.0 (sv-esperanza.local; OpenStreetMap-compatible)"}

    for z in range(min_z, max_z + 1):
        x0, y0, x1, y1 = tile_bounds(region, z)
        z_total = (x1 - x0 + 1) * (y1 - y0 + 1)
        z_done  = 0

        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                row = mbtiles_row(y, z)

                # Skip if already in DB
                exists = c.execute(
                    "SELECT 1 FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                    (z, x, row)
                ).fetchone()
                if exists:
                    skipped += 1
                    done    += 1
                    z_done  += 1
                    continue

                url = TILE_URL.format(z=z, x=x, y=y)
                try:
                    req  = urllib.request.Request(url, headers=headers)
                    resp = urllib.request.urlopen(req, timeout=15)
                    data = resp.read()
                    batch.append((z, x, row, data))
                    time.sleep(DELAY_S)
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        pass  # Tile outside NOAA coverage (ocean, Canada, etc.)
                    else:
                        errors += 1
                except Exception:
                    errors += 1

                done   += 1
                z_done += 1

                # Flush batch every 200 tiles
                if len(batch) >= 200:
                    c.executemany(
                        "INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)",
                        batch
                    )
                    conn.commit()
                    batch.clear()

                # Progress line
                pct = done / total * 100
                sys.stdout.write(
                    f"\r  z{z:2d}: {z_done:4d}/{z_total:<4d}   "
                    f"Total: {done:6,}/{total:,} ({pct:5.1f}%)  "
                    f"errors:{errors}"
                )
                sys.stdout.flush()

        print()  # newline after each zoom level

    # Flush remaining
    if batch:
        c.executemany("INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)", batch)
        conn.commit()

    return done, skipped, errors

# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Download NOAA chart tiles → MBTiles for offline use")
    parser.add_argument("--min-zoom", type=int, default=8,  help="Minimum zoom level (default: 8)")
    parser.add_argument("--max-zoom", type=int, default=16, help="Maximum zoom level (default: 16)")
    parser.add_argument("--output",   default=OUTPUT,       help=f"Output MBTiles path (default: {OUTPUT})")
    parser.add_argument("--resume",   action="store_true",  help="Resume interrupted download (skip existing tiles)")
    args = parser.parse_args()

    print("=" * 60)
    print("  SV-Esperanza — NOAA Chart Tile Downloader")
    print("=" * 60)
    print()

    total_est = count_tiles(REGION, args.min_zoom, args.max_zoom)
    est_mb    = total_est * 40 / 1024  # rough ~40KB/tile average
    est_min   = total_est * DELAY_S / 60 + total_est * 0.1 / 60
    print(f"  Estimated tiles: ~{total_est:,}")
    print(f"  Estimated size:  ~{est_mb:.0f} MB")
    print(f"  Estimated time:  ~{est_min:.0f} minutes")
    print(f"  Output:          {args.output}")
    print()

    if not args.resume and os.path.exists(args.output):
        ans = input("Output file exists. Overwrite? (y/N) ").strip().lower()
        if ans != "y":
            print("Use --resume to continue an interrupted download.")
            sys.exit(0)
        os.remove(args.output)

    conn = init_mbtiles(args.output, REGION, args.min_zoom, args.max_zoom)

    t0 = time.time()
    done, skipped, errors = download_tiles(conn, REGION, args.min_zoom, args.max_zoom)
    elapsed = time.time() - t0
    size_mb = os.path.getsize(args.output) / 1024 / 1024

    conn.close()

    print()
    print("=" * 60)
    print(f"  ✓ Done! {done:,} tiles in {elapsed:.0f}s")
    print(f"  Skipped (already cached): {skipped:,}")
    print(f"  Errors (404/timeout):     {errors:,}")
    print(f"  Output file size:         {size_mb:.1f} MB")
    print()
    print("  SignalK charts plugin will auto-detect this file.")
    print("  Restart SignalK to load: sudo systemctl restart signalk")
    print("=" * 60)

if __name__ == "__main__":
    main()
