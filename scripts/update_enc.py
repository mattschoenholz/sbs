#!/usr/bin/env python3
"""
update_enc.py — Weekly NOAA ENC chart update and PMTiles rebuild.

Cron (weekly, Sunday 3am):
    0 3 * * 0 python3 /home/pi/scripts/update_enc.py

What this does:
  1. HTTP HEAD each NOAA ENC chart ZIP — compares Last-Modified / ETag to a
     local state file. Downloads only charts that have changed.
  2. If any chart changed: calls setup_enc_wms.py logic to rebuild enc_merged.gpkg.
  3. Runs ogr2ogr → tippecanoe → pmtiles convert pipeline.
  4. Atomic swap: writes enc.pmtiles.tmp then renames to enc.pmtiles.
  5. Logs everything to /var/log/update_enc.log with timestamps.

Dependencies: Python stdlib + subprocess only (ogr2ogr, tippecanoe, pmtiles must
be installed on the Pi — run install_vector_charts.sh first).
"""

import glob
import hashlib
import http.client
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# ─── Configuration ────────────────────────────────────────────────────────────

ENC_DIR        = "/data/charts/noaa_enc"
GPKG_PATH      = "/data/charts/enc_merged.gpkg"
PMTILES_PATH   = "/data/charts/enc.pmtiles"
PMTILES_TMP    = "/data/charts/enc.pmtiles.tmp"
MBTILES_TMP    = "/tmp/enc_build.mbtiles"
STATE_FILE     = "/data/charts/.update_state.json"
LOG_FILE       = "/var/log/update_enc.log"

# NOAA chart IDs to maintain (PNW coverage)
CHART_IDS = [
    "US3WA15M",  # Puget Sound north
    "US3WA16M",  # Puget Sound south
    "US3WA17M",  # San Juan Islands
    "US3WA20M",  # Strait of Juan de Fuca
    "US4WA01M",  # Port Townsend harbor
]

NOAA_BASE_URL = "https://charts.noaa.gov/ENCs/{chart_id}.zip"

# S-57 layers to export for vector tiles (matches VECTOR_CHARTS.md Step 3)
ENC_LAYERS = [
    "DEPARE", "DEPCNT", "SOUNDG", "LNDARE", "COALNE",
    "SBDARE", "WRECKS", "OBSTRN", "UWTROC", "SLCONS", "DRGARE",
]

# ─── Logging setup ────────────────────────────────────────────────────────────

def setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    handlers = [logging.FileHandler(LOG_FILE)]
    if sys.stdout.isatty():
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )

log = logging.getLogger(__name__)

# ─── State management ─────────────────────────────────────────────────────────

def load_state():
    """Load persisted HTTP header state (Last-Modified, ETag per chart)."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Could not read state file %s: %s", STATE_FILE, e)
    return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    log.debug("State saved to %s", STATE_FILE)

# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def http_head(url, timeout=30):
    """
    Perform an HTTP HEAD request. Returns dict with keys:
      last_modified, etag, content_length  (all may be None).
    Returns None on network error.
    """
    parsed = urlparse(url)
    try:
        if parsed.scheme == "https":
            conn = http.client.HTTPSConnection(parsed.netloc, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(parsed.netloc, timeout=timeout)

        path = parsed.path
        if parsed.query:
            path += "?" + parsed.query

        conn.request("HEAD", path, headers={"User-Agent": "SailboatServer/1.0"})
        resp = conn.getresponse()
        conn.close()

        return {
            "last_modified": resp.getheader("Last-Modified"),
            "etag": resp.getheader("ETag"),
            "content_length": resp.getheader("Content-Length"),
            "status": resp.status,
        }
    except (OSError, http.client.HTTPException) as e:
        log.warning("HEAD %s failed: %s", url, e)
        return None


def chart_url(chart_id):
    return NOAA_BASE_URL.format(chart_id=chart_id)


def chart_has_changed(chart_id, state):
    """
    Return True if the remote chart differs from what we last downloaded.
    Uses Last-Modified or ETag; if neither available, returns True (force download).
    """
    url = chart_url(chart_id)
    headers = http_head(url)
    if headers is None:
        log.warning("%s: HEAD request failed — skipping this chart", chart_id)
        return False, None

    if headers["status"] not in (200, 206):
        log.warning("%s: unexpected HEAD status %s", chart_id, headers["status"])
        return False, None

    prev = state.get(chart_id, {})
    remote_lm = headers.get("last_modified")
    remote_et = headers.get("etag")

    changed = False
    if remote_et:
        changed = remote_et != prev.get("etag")
    elif remote_lm:
        changed = remote_lm != prev.get("last_modified")
    else:
        # No cache headers — always re-download
        log.info("%s: no cache headers, will download", chart_id)
        changed = True

    return changed, headers


def download_chart(chart_id, dest_dir):
    """Download chart ZIP and extract to dest_dir/{chart_id}/."""
    url = chart_url(chart_id)
    zip_path = os.path.join("/tmp", f"{chart_id}.zip")
    chart_dest = os.path.join(dest_dir, chart_id)

    log.info("%s: downloading %s", chart_id, url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SailboatServer/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, \
             open(zip_path, "wb") as out:
            total = resp.getheader("Content-Length")
            downloaded = 0
            chunk = 65536
            while True:
                data = resp.read(chunk)
                if not data:
                    break
                out.write(data)
                downloaded += len(data)
        log.info("%s: downloaded %d bytes", chart_id, downloaded)
    except (urllib.error.URLError, OSError) as e:
        log.error("%s: download failed: %s", chart_id, e)
        return False

    log.info("%s: extracting to %s", chart_id, chart_dest)
    os.makedirs(chart_dest, exist_ok=True)
    try:
        subprocess.run(
            ["unzip", "-o", "-q", zip_path, "-d", chart_dest],
            check=True, timeout=60,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.error("%s: unzip failed: %s", chart_id, e)
        return False
    finally:
        try:
            os.unlink(zip_path)
        except OSError:
            pass

    log.info("%s: extracted OK", chart_id)
    return True

# ─── GPKG rebuild (mirrors setup_enc_wms.py logic) ────────────────────────────

def find_enc_files():
    """Find all .000 S-57 files under ENC_DIR (same pattern as setup_enc_wms.py)."""
    return sorted(glob.glob(f"{ENC_DIR}/*/ENC_ROOT/*/*.000"))


def rebuild_gpkg(enc_files, gpkg_path):
    """
    Merge all S-57 .000 files into a single GeoPackage using ogr2ogr.
    Each layer is merged across all chart files.
    """
    log.info("Rebuilding GPKG: %s  (%d ENC files)", gpkg_path, len(enc_files))

    gpkg_tmp = gpkg_path + ".tmp"
    if os.path.exists(gpkg_tmp):
        os.unlink(gpkg_tmp)

    first = True
    for enc_path in enc_files:
        log.debug("  Merging: %s", enc_path)
        for layer in ENC_LAYERS:
            cmd = [
                "ogr2ogr",
                "-f", "GPKG",
                gpkg_tmp,
                enc_path,
                layer,
                "-t_srs", "EPSG:4326",
                "-update" if not first else "-nln", layer if first else layer,
            ]
            # Rebuild the command cleanly for first vs. append
            if first:
                cmd = [
                    "ogr2ogr",
                    "-f", "GPKG",
                    gpkg_tmp,
                    enc_path,
                    layer,
                    "-t_srs", "EPSG:4326",
                ]
            else:
                cmd = [
                    "ogr2ogr",
                    "-f", "GPKG",
                    "-update", "-append",
                    gpkg_tmp,
                    enc_path,
                    layer,
                    "-t_srs", "EPSG:4326",
                ]
            result = subprocess.run(
                cmd,
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0 and result.returncode != 1:
                # ogr2ogr returns 1 when a layer doesn't exist in this file — that's OK
                log.warning("  ogr2ogr returned %d for %s/%s: %s",
                            result.returncode, os.path.basename(enc_path), layer,
                            result.stderr.strip()[:200])
        first = False

    if not os.path.exists(gpkg_tmp):
        log.error("GPKG build produced no output file")
        return False

    os.replace(gpkg_tmp, gpkg_path)
    log.info("GPKG written: %s", gpkg_path)
    return True

# ─── Also rebuild the WMS VRT + mapfile (keep MapServer in sync) ──────────────

def rebuild_wms_if_available(enc_files):
    """
    If setup_enc_wms.py is importable, run it to keep the WMS pipeline in sync.
    Non-fatal if it fails or is not available.
    """
    script = os.path.join(os.path.dirname(__file__), "setup_enc_wms.py")
    if not os.path.exists(script):
        return
    try:
        log.info("Re-running setup_enc_wms.py to rebuild VRT/mapfile...")
        result = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            log.info("setup_enc_wms.py: OK")
        else:
            log.warning("setup_enc_wms.py exited %d: %s",
                        result.returncode, result.stderr.strip()[:300])
    except Exception as e:
        log.warning("setup_enc_wms.py failed (non-fatal): %s", e)

# ─── PMTiles build pipeline ───────────────────────────────────────────────────

def export_geojsonl(gpkg_path, layer, out_path):
    """Export one GPKG layer to GeoJSONSeq (.geojsonl)."""
    cmd = [
        "ogr2ogr",
        "-f", "GeoJSONSeq",
        out_path,
        gpkg_path,
        layer,
        "-t_srs", "EPSG:4326",
        "-lco", "COORDINATE_PRECISION=6",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        log.warning("ogr2ogr export of %s failed (may not exist in GPKG): %s",
                    layer, result.stderr.strip()[:200])
        return False
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        log.debug("Layer %s produced no features — skipping", layer)
        return False
    return True


def run_tippecanoe(layer_files, mbtiles_out):
    """Run tippecanoe with the flags from VECTOR_CHARTS.md Step 3."""
    if os.path.exists(mbtiles_out):
        os.unlink(mbtiles_out)

    cmd = [
        "tippecanoe",
        f"--output={mbtiles_out}",
        "--minimum-zoom=8",
        "--maximum-zoom=16",
        "--no-tile-compression",
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "--force",
    ]
    for layer, path in layer_files:
        cmd += [f"--layer={layer}", path]

    log.info("Running tippecanoe (this takes ~10 min on Pi 5)...")
    log.debug("tippecanoe cmd: %s", " ".join(cmd))

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        log.error("tippecanoe failed:\n%s", result.stderr[-1000:])
        return False
    log.info("tippecanoe: done — %s", mbtiles_out)
    return True


def run_pmtiles_convert(mbtiles_in, pmtiles_out):
    """Convert MBTiles → PMTiles using the pmtiles CLI."""
    if os.path.exists(pmtiles_out):
        os.unlink(pmtiles_out)
    cmd = ["pmtiles", "convert", mbtiles_in, pmtiles_out]
    log.info("Converting MBTiles → PMTiles...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        log.error("pmtiles convert failed:\n%s", result.stderr[-500:])
        return False
    log.info("PMTiles written: %s", pmtiles_out)
    return True


def verify_pmtiles(pmtiles_path):
    """Run 'pmtiles show' to sanity-check the output file."""
    result = subprocess.run(
        ["pmtiles", "show", pmtiles_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode == 0:
        for line in result.stdout.strip().splitlines()[:8]:
            log.info("  pmtiles show: %s", line)
        return True
    log.warning("pmtiles show failed: %s", result.stderr.strip()[:200])
    return False


def build_pmtiles(gpkg_path, pmtiles_final, mbtiles_tmp=MBTILES_TMP):
    """
    Full ogr2ogr → tippecanoe → pmtiles pipeline.
    Atomic swap: builds to enc.pmtiles.tmp, then renames.
    """
    log.info("--- PMTiles build pipeline ---")

    tmp_geojsonl = []
    layer_files = []

    try:
        # Export each layer to /tmp
        for layer in ENC_LAYERS:
            out = f"/tmp/enc_{layer}.geojsonl"
            log.info("Exporting layer: %s", layer)
            ok = export_geojsonl(gpkg_path, layer, out)
            if ok:
                layer_files.append((layer, out))
                tmp_geojsonl.append(out)
            else:
                log.info("  (no features for %s — excluded from tile set)", layer)

        if not layer_files:
            log.error("No layers exported — aborting PMTiles build")
            return False

        # Tippecanoe: MBTiles
        if not run_tippecanoe(layer_files, mbtiles_tmp):
            return False

        # PMTiles convert (to .tmp for atomic swap)
        pmtiles_tmp_path = pmtiles_final + ".tmp"
        if not run_pmtiles_convert(mbtiles_tmp, pmtiles_tmp_path):
            return False

        # Atomic rename
        os.replace(pmtiles_tmp_path, pmtiles_final)
        log.info("Atomic swap complete: %s", pmtiles_final)

        verify_pmtiles(pmtiles_final)
        return True

    finally:
        # Clean up temp files
        for path in tmp_geojsonl:
            try:
                os.unlink(path)
            except OSError:
                pass
        try:
            os.unlink(mbtiles_tmp)
        except OSError:
            pass

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    setup_logging()
    log.info("======================================================")
    log.info("update_enc.py starting")
    log.info("======================================================")

    os.makedirs(ENC_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(PMTILES_PATH), exist_ok=True)

    state = load_state()
    any_changed = False

    # Step 1 — Check each chart for updates
    log.info("--- Checking NOAA ENC charts for updates ---")
    for chart_id in CHART_IDS:
        url = chart_url(chart_id)
        changed, headers = chart_has_changed(chart_id, state)

        if headers is None:
            # Network error — skip this chart entirely
            continue

        if not changed:
            log.info("%s: up to date", chart_id)
            continue

        log.info("%s: changed — downloading", chart_id)
        success = download_chart(chart_id, ENC_DIR)
        if success:
            any_changed = True
            # Update state with new headers
            state[chart_id] = {
                "last_modified": headers.get("last_modified"),
                "etag": headers.get("etag"),
                "downloaded_at": datetime.now(timezone.utc).isoformat(),
            }
            save_state(state)
        else:
            log.error("%s: download failed — will retry next run", chart_id)

    if not any_changed:
        log.info("No charts changed — nothing to rebuild.")
        log.info("Done.")
        return

    # Step 2 — Rebuild GPKG
    log.info("--- Rebuilding GPKG ---")
    enc_files = find_enc_files()
    if not enc_files:
        log.error("No .000 ENC files found under %s — aborting", ENC_DIR)
        sys.exit(1)
    log.info("Found %d .000 ENC files", len(enc_files))

    if not rebuild_gpkg(enc_files, GPKG_PATH):
        log.error("GPKG rebuild failed — aborting")
        sys.exit(1)

    # Step 2b — Keep WMS pipeline in sync (non-fatal)
    rebuild_wms_if_available(enc_files)

    # Step 3 — Build PMTiles
    if not build_pmtiles(GPKG_PATH, PMTILES_PATH):
        log.error("PMTiles build failed")
        sys.exit(1)

    log.info("======================================================")
    log.info("update_enc.py complete — PMTiles updated: %s", PMTILES_PATH)
    log.info("======================================================")


if __name__ == "__main__":
    main()
