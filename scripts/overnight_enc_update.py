#!/usr/bin/env python3
"""
Overnight ENC update script.
Downloads all NOAA ENC charts for WA/OR plus attempts CHS (Canadian) charts for BC,
then rebuilds the OGR VRT, soundings.geojson, and PMTiles.

Run on the Pi:  sudo python3 /tmp/overnight_enc_update.py
"""

import os, sys, glob, json, subprocess, time, re, urllib.request, zipfile, shutil
from pathlib import Path
from xml.etree import ElementTree as ET

ENC_DIR        = Path("/data/charts/noaa_enc")
CHARTS_DIR     = Path("/data/charts")
VRT_PATH       = CHARTS_DIR / "enc_all.vrt"
SOUNDINGS_PATH = CHARTS_DIR / "soundings.geojson"

# NOAA ENC direct download base
NOAA_BASE = "https://charts.noaa.gov/ENCs"

# NOAA ENC product catalog URLs to scan
NOAA_CATALOGS = [
    "https://charts.noaa.gov/ENCs/WA_ENCProdCat_19115.xml",
    "https://charts.noaa.gov/ENCs/OR_ENCProdCat_19115.xml",
    "https://charts.noaa.gov/ENCs/AK_ENCProdCat_19115.xml",  # SE Alaska for context
]

# Known CHS (Canadian) ENC chart IDs for BC inner/outer coast
# Source: CHS chart catalogue, BC coastal waters
# Strait of Juan de Fuca, Strait of Georgia, Gulf Islands, outside Vancouver Island
CHS_CHART_IDS = [
    # Strait of Juan de Fuca (east end, shared with US)
    "CA379143", "CA379144", "CA379145",
    # Strait of Georgia (south)
    "CA379120", "CA379121", "CA379122", "CA379123", "CA379124",
    # Gulf Islands
    "CA379107", "CA379108", "CA379109", "CA379110", "CA379111",
    # Haro Strait / San Juan area (Canadian side)
    "CA379140", "CA379141", "CA379142",
    # Strait of Georgia (central)
    "CA379100", "CA379101", "CA379102", "CA379103",
    # Outside Vancouver Island (west coast, south)
    "CA3730", "CA3771", "CA3772", "CA3775",
    # Barkley Sound
    "CA3670", "CA3671",
    # Johnstone Strait
    "CA3543", "CA3544", "CA3545",
    # Queen Charlotte Sound
    "CA3547",
    # Nanaimo / southern Strait of Georgia
    "CA3458", "CA3459", "CA3463",
    # Victoria / Saanich Inlet
    "CA3441", "CA3440", "CA3442",
    # Active Pass / Sidney
    "CA3476", "CA3478",
]

# CHS download URL patterns to try (multiple possible endpoints)
CHS_DOWNLOAD_URLS = [
    "https://charts.gc.ca/charts/ENCs/{id}.zip",
    "https://www.charts.gc.ca/charts/ENCs/{id}.zip",
    "https://data.charts.gc.ca/ENCs/{id}.zip",
]

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def run(cmd, check=True):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0 and check:
        log(f"  CMD FAILED: {cmd}")
        log(f"  STDERR: {result.stderr[:200]}")
    return result

def already_installed(chart_id):
    """Check if a chart is already installed with correct path structure."""
    expected = ENC_DIR / chart_id / "ENC_ROOT" / chart_id / f"{chart_id}.000"
    return expected.exists()

def install_zip(chart_id, zip_path):
    """Unzip a chart into the standard directory structure."""
    target = ENC_DIR / chart_id
    target.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(target)
        # Normalize: find the .000 file and ensure it's at expected path
        found = list(target.rglob(f"{chart_id}.000"))
        if not found:
            found = list(target.rglob("*.000"))
        if found:
            src = found[0]
            expected_dir = target / "ENC_ROOT" / chart_id
            expected_dir.mkdir(parents=True, exist_ok=True)
            expected = expected_dir / f"{chart_id}.000"
            if src != expected and not expected.exists():
                shutil.copy2(src, expected)
            return True
        else:
            log(f"  WARNING: No .000 file found in {zip_path}")
            return False
    except zipfile.BadZipFile:
        log(f"  ERROR: Bad zip file for {chart_id}")
        return False

def download_noaa_enc(chart_id):
    """Download a NOAA ENC chart."""
    if already_installed(chart_id):
        return "skip"
    url = f"{NOAA_BASE}/{chart_id}.zip"
    zip_path = Path(f"/tmp/{chart_id}.zip")
    try:
        log(f"  Downloading NOAA {chart_id}...")
        urllib.request.urlretrieve(url, zip_path)
        if install_zip(chart_id, zip_path):
            zip_path.unlink(missing_ok=True)
            return "ok"
        zip_path.unlink(missing_ok=True)
        return "fail"
    except Exception as e:
        log(f"  FAIL {chart_id}: {e}")
        zip_path.unlink(missing_ok=True)
        return "fail"

def try_download_chs_enc(chart_id):
    """Try multiple URL patterns for a CHS (Canadian) ENC chart."""
    if already_installed(chart_id):
        return "skip"
    zip_path = Path(f"/tmp/{chart_id}.zip")
    for url_tmpl in CHS_DOWNLOAD_URLS:
        url = url_tmpl.format(id=chart_id)
        try:
            urllib.request.urlretrieve(url, zip_path)
            if zip_path.stat().st_size > 1000:  # not an error page
                log(f"  Downloaded CHS {chart_id} from {url}")
                if install_zip(chart_id, zip_path):
                    zip_path.unlink(missing_ok=True)
                    return "ok"
        except Exception:
            pass
        zip_path.unlink(missing_ok=True)
    return "fail"

def parse_noaa_catalog(url):
    """Download and parse a NOAA ENC product catalog XML, return list of chart IDs."""
    chart_ids = []
    try:
        log(f"  Fetching catalog: {url}")
        with urllib.request.urlopen(url, timeout=30) as r:
            content = r.read().decode("utf-8", errors="ignore")
        # Chart IDs appear as US5WAxxM or US4WAxxM etc. in file identifier fields
        ids = re.findall(r'\b(US[1-9][A-Z]{2}[0-9]{2}[A-Z])\b', content)
        chart_ids = sorted(set(ids))
        log(f"  Found {len(chart_ids)} charts: {chart_ids[:5]}...")
    except Exception as e:
        log(f"  Catalog fetch failed: {e}")
    return chart_ids

def rebuild_vrt():
    """Rebuild OGR VRT XML to include all installed .000 files."""
    log("Rebuilding OGR VRT...")
    enc_files = sorted(ENC_DIR.rglob("*.000"))
    # De-duplicate by chart ID (use the standard path if multiple exist)
    by_id = {}
    for f in enc_files:
        cid = f.stem
        # Prefer the standard path structure
        if cid not in by_id or "ENC_ROOT" in str(f):
            by_id[cid] = f

    files = sorted(by_id.values(), key=lambda f: f.stem)
    log(f"  Found {len(files)} unique ENC files")

    # OGR VRT layers — must include all layers extracted by rebuild_pmtiles.sh
    layers = [
        "DEPARE", "DEPCNT", "LNDARE", "COALNE",
        "WRECKS", "OBSTRN", "UWTROC", "SLCONS", "DRGARE", "SBDARE",
        "BOYCAR", "BOYLAT", "BOYSAW", "BOYSPP",
        "BCNLAT", "BCNCAR", "BCNISD", "BCNSPP",
        "TSSLPT", "TSSRON", "TRAFIC", "FAIRWY",
        "AIRARE", "ACHARE", "RESARE",
        "LIGHTS",
    ]

    lines = ['<OGRVRTDataSource>']
    for layer in layers:
        lines.append(f'  <OGRVRTUnionLayer name="{layer}">')
        for f in files:
            cid = f.stem
            lines.append(f'    <OGRVRTLayer name="{cid}_{layer}">')
            lines.append(f'      <SrcDataSource>{f}</SrcDataSource>')
            lines.append(f'      <SrcLayer>{layer}</SrcLayer>')
            lines.append(f'    </OGRVRTLayer>')
        lines.append(f'  </OGRVRTUnionLayer>')
    lines.append('</OGRVRTDataSource>')

    VRT_PATH.write_text("\n".join(lines))
    log(f"  VRT written: {len(files)} charts × {len(layers)} layers")
    return files

def rebuild_soundings(enc_files):
    """Extract SOUNDG from all ENC files into soundings.geojson."""
    log("Rebuilding soundings.geojson...")
    try:
        from osgeo import ogr
    except ImportError:
        log("  ERROR: GDAL Python bindings not available")
        return 0

    features = []
    for enc_path in enc_files:
        ds = ogr.Open(str(enc_path))
        if not ds:
            continue
        lyr = ds.GetLayerByName("SOUNDG")
        if not lyr:
            ds = None
            continue
        for feat in lyr:
            geom = feat.GetGeometryRef()
            if not geom:
                continue
            n = geom.GetGeometryCount()
            if n > 0:
                # MULTIPOINT — each sub-geometry Z is the depth
                for i in range(n):
                    pt = geom.GetGeometryRef(i)
                    depth = pt.GetZ()
                    if depth is not None:
                        d_str = str(int(depth)) if depth == int(depth) else str(round(depth, 1))
                        features.append({
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": [
                                round(pt.GetX(), 6), round(pt.GetY(), 6)]},
                            "properties": {"DEPTH": d_str}
                        })
            else:
                # Single POINT
                depth = geom.GetZ() or feat.GetField("VALSOU") if hasattr(feat, "GetField") else None
                if depth:
                    d_str = str(int(depth)) if depth == int(depth) else str(round(depth, 1))
                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [
                            round(geom.GetX(), 6), round(geom.GetY(), 6)]},
                        "properties": {"DEPTH": d_str}
                    })
        ds = None

    with open(SOUNDINGS_PATH, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    log(f"  soundings.geojson: {len(features)} soundings written")
    return len(features)

def rebuild_pmtiles():
    """Run the PMTiles rebuild script."""
    log("Running PMTiles rebuild (this takes several minutes)...")
    script = Path("/tmp/rebuild_pmtiles.sh")
    result = run(f"sudo bash {script} >> /tmp/overnight_enc_update.log 2>&1", check=False)
    if result.returncode == 0:
        log("PMTiles rebuild complete")
    else:
        log(f"PMTiles rebuild exited {result.returncode} — check log")

# ── Main ──────────────────────────────────────────────────────────────────────

log("=" * 60)
log("Overnight ENC update started")
log("=" * 60)

# 1. Parse NOAA catalogs and collect all chart IDs
log("\n[1/5] Scanning NOAA ENC catalogs...")
all_noaa_ids = set()
for catalog_url in NOAA_CATALOGS:
    ids = parse_noaa_catalog(catalog_url)
    all_noaa_ids.update(ids)
log(f"  Total NOAA chart IDs found: {len(all_noaa_ids)}")

# 2. Download missing NOAA charts
log("\n[2/5] Downloading missing NOAA ENC charts...")
ok = skip = fail = 0
for chart_id in sorted(all_noaa_ids):
    result = download_noaa_enc(chart_id)
    if result == "ok":   ok += 1
    elif result == "skip": skip += 1
    else: fail += 1
log(f"  NOAA: {ok} downloaded, {skip} already installed, {fail} failed")

# 3. Attempt Canadian (CHS) charts
log("\n[3/5] Attempting CHS (Canadian) ENC downloads...")
chs_ok = chs_fail = chs_skip = 0
for chart_id in CHS_CHART_IDS:
    result = try_download_chs_enc(chart_id)
    if result == "ok":   chs_ok += 1
    elif result == "skip": chs_skip += 1
    else: chs_fail += 1
log(f"  CHS: {chs_ok} downloaded, {chs_skip} already installed, {chs_fail} not found")
if chs_ok == 0 and chs_fail > 0:
    log("  NOTE: CHS charts not auto-downloadable from these URLs.")
    log("  Manual download: https://www.charts.gc.ca/")

# 4. Rebuild VRT with all installed files
log("\n[4/5] Rebuilding VRT and soundings...")
enc_files = rebuild_vrt()
rebuild_soundings(enc_files)

# 5. Rebuild PMTiles
log("\n[5/5] Rebuilding PMTiles...")
rebuild_pmtiles()

log("\n" + "=" * 60)
log("Overnight ENC update COMPLETE")
log("=" * 60)
