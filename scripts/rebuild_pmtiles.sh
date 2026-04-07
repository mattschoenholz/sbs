#!/bin/bash
# Rebuild enc.pmtiles from scratch with all ENC layers + soundings.
# Run on the Pi: sudo bash ~/rebuild_pmtiles.sh
set -eo pipefail
# Don't fail on ogr2ogr errors — some layers may be empty in certain charts

VRT=/data/charts/enc_all.vrt
SNDG=/data/charts/soundings.geojson
OUT=/data/charts/enc.pmtiles
TMP=/tmp/enc_pmtiles_build
mkdir -p $TMP

echo "=== Rebuild ENC PMTiles ==="

echo "[1/4] Extracting layers from VRT..."
# -dim XY:      force 2D (drop Z/M from S-57 3D geometries)
# -explodecollections: split GeometryCollections / Multi* into single features
# -skipfailures: skip any malformed S-57 features without aborting
for layer in \
  DEPARE DEPCNT LNDARE COALNE \
  WRECKS OBSTRN UWTROC SLCONS DRGARE \
  BOYCAR BOYLAT BOYSAW BOYSPP BCNLAT BCNCAR BCNISD BCNSPP \
  TSSLPT TSSRON TRAFIC FAIRWY \
  AIRARE ACHARE RESARE \
  LIGHTS; do
  echo "  $layer..."
  ogr2ogr -f GeoJSONSeq -dim XY -explodecollections -skipfailures \
    $TMP/${layer}.geojsonl $VRT $layer 2>&1 | grep -v "^$" | head -3 || true
  count=$(wc -l < $TMP/${layer}.geojsonl 2>/dev/null || echo 0)
  echo "    $count features"
done

echo "[2/4] Converting soundings to GeoJSONL..."
python3 - <<'PYEOF'
import json
with open('/data/charts/soundings.geojson') as f:
    fc = json.load(f)
with open('/tmp/enc_pmtiles_build/SOUNDG.geojsonl', 'w') as out:
    for feat in fc['features']:
        out.write(json.dumps(feat) + '\n')
print(f"  {len(fc['features'])} soundings written")
PYEOF

echo "[3/4] Running tippecanoe..."
# -L NAME:FILE is the correct multi-layer syntax for tippecanoe v2.x
# --no-tile-size-limit: don't drop features to hit 500KB limit (polygon areas can be large)
# Hard zoom cap at 14 — no extend-zooms-if-still-dropping (caused 7hr+ runaway builds)
tippecanoe \
  --output=$TMP/enc_new.mbtiles \
  --minimum-zoom=7 \
  --maximum-zoom=14 \
  --drop-densest-as-needed \
  --no-tile-size-limit \
  --force \
  -L DEPARE:$TMP/DEPARE.geojsonl \
  -L DEPCNT:$TMP/DEPCNT.geojsonl \
  -L LNDARE:$TMP/LNDARE.geojsonl \
  -L COALNE:$TMP/COALNE.geojsonl \
  -L WRECKS:$TMP/WRECKS.geojsonl \
  -L OBSTRN:$TMP/OBSTRN.geojsonl \
  -L UWTROC:$TMP/UWTROC.geojsonl \
  -L SLCONS:$TMP/SLCONS.geojsonl \
  -L DRGARE:$TMP/DRGARE.geojsonl \
  -L BOYCAR:$TMP/BOYCAR.geojsonl \
  -L BOYLAT:$TMP/BOYLAT.geojsonl \
  -L BOYSAW:$TMP/BOYSAW.geojsonl \
  -L BOYSPP:$TMP/BOYSPP.geojsonl \
  -L BCNLAT:$TMP/BCNLAT.geojsonl \
  -L BCNCAR:$TMP/BCNCAR.geojsonl \
  -L BCNISD:$TMP/BCNISD.geojsonl \
  -L BCNSPP:$TMP/BCNSPP.geojsonl \
  -L TSSLPT:$TMP/TSSLPT.geojsonl \
  -L TSSRON:$TMP/TSSRON.geojsonl \
  -L TRAFIC:$TMP/TRAFIC.geojsonl \
  -L FAIRWY:$TMP/FAIRWY.geojsonl \
  -L AIRARE:$TMP/AIRARE.geojsonl \
  -L ACHARE:$TMP/ACHARE.geojsonl \
  -L RESARE:$TMP/RESARE.geojsonl \
  -L LIGHTS:$TMP/LIGHTS.geojsonl \
  -L SOUNDG:$TMP/SOUNDG.geojsonl

echo "[4/4] Converting to PMTiles..."
pmtiles convert $TMP/enc_new.mbtiles $OUT

echo ""
echo "=== Done! Layers in $OUT: ==="
pmtiles show $OUT --metadata | python3 -c "
import sys, json
d = json.load(sys.stdin)
for l in d.get('vector_layers', []):
    fields = list(l.get('fields', {}).keys())
    print(f'  {l[\"id\"]} ({len(fields)} fields)')
"

echo ""
echo "Cleanup temp files..."
rm -rf $TMP
echo "Complete."
