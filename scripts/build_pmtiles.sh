#!/usr/bin/env bash
# build_pmtiles.sh — Manually trigger ogr2ogr → tippecanoe → pmtiles pipeline.
#
# Use this for testing or forced rebuilds without re-downloading chart ZIPs.
#
# Usage:
#   bash scripts/build_pmtiles.sh
#   bash scripts/build_pmtiles.sh --input /data/charts/enc_merged.gpkg
#
# Defaults:
#   --input   /data/charts/enc_merged.gpkg
#   output    /data/charts/enc.pmtiles   (atomic: writes .tmp first)

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
GPKG_PATH="/data/charts/enc_merged.gpkg"
PMTILES_FINAL="/data/charts/enc.pmtiles"
MBTILES_TMP="/tmp/enc_build.mbtiles"

# S-57 layers (matches VECTOR_CHARTS.md Step 3 exactly)
LAYERS=(DEPARE DEPCNT SOUNDG LNDARE COALNE SBDARE WRECKS OBSTRN UWTROC SLCONS DRGARE)

# ─── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --input)
            GPKG_PATH="$2"
            shift 2
            ;;
        --input=*)
            GPKG_PATH="${1#--input=}"
            shift
            ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
die()  { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; exit 1; }

cleanup() {
    log "Cleaning up temp files..."
    for layer in "${LAYERS[@]}"; do
        rm -f "/tmp/enc_${layer}.geojsonl"
    done
    rm -f "$MBTILES_TMP"
}
trap cleanup EXIT

# ─── Preflight ────────────────────────────────────────────────────────────────
[[ -f "$GPKG_PATH" ]] || die "Input GPKG not found: $GPKG_PATH"
command -v ogr2ogr   &>/dev/null || die "ogr2ogr not found (install gdal-bin)"
command -v tippecanoe &>/dev/null || die "tippecanoe not found (run install_vector_charts.sh)"
command -v pmtiles   &>/dev/null || die "pmtiles not found (run install_vector_charts.sh)"

log "============================================================"
log " SailboatServer — PMTiles build"
log " Input GPKG : $GPKG_PATH"
log " Output     : $PMTILES_FINAL"
log "============================================================"

# ─── Step 1: Export each layer to GeoJSONSeq ─────────────────────────────────
log "--- Step 1: ogr2ogr — export layers to GeoJSONSeq ---"

TIPPECANOE_LAYER_ARGS=()
for layer in "${LAYERS[@]}"; do
    out="/tmp/enc_${layer}.geojsonl"
    log "  Exporting layer: $layer"

    ogr2ogr \
        -f GeoJSONSeq \
        "$out" \
        "$GPKG_PATH" \
        "$layer" \
        -t_srs EPSG:4326 \
        -lco COORDINATE_PRECISION=6 \
        2>/dev/null || true   # layer may not exist in every GPKG

    if [[ -s "$out" ]]; then
        log "    OK — $(wc -l < "$out") features"
        TIPPECANOE_LAYER_ARGS+=("--layer=${layer}" "$out")
    else
        log "    (no features — skipping)"
        rm -f "$out"
    fi
done

if [[ ${#TIPPECANOE_LAYER_ARGS[@]} -eq 0 ]]; then
    die "No features exported from any layer. Check that GPKG is valid and contains S-57 data."
fi

# ─── Step 2: tippecanoe — MBTiles ────────────────────────────────────────────
log "--- Step 2: tippecanoe — build MBTiles (~10 min on Pi 5) ---"
log "  Output: $MBTILES_TMP"

rm -f "$MBTILES_TMP"

tippecanoe \
    --output="$MBTILES_TMP" \
    --minimum-zoom=8 \
    --maximum-zoom=16 \
    --no-tile-compression \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    --force \
    "${TIPPECANOE_LAYER_ARGS[@]}"

log "  tippecanoe done: $MBTILES_TMP"

# ─── Step 3: pmtiles convert — atomic output ─────────────────────────────────
log "--- Step 3: pmtiles convert — MBTiles → PMTiles ---"

PMTILES_TMP_PATH="${PMTILES_FINAL}.tmp"
rm -f "$PMTILES_TMP_PATH"

pmtiles convert "$MBTILES_TMP" "$PMTILES_TMP_PATH"

# Atomic rename so the live file is never partially written
mv "$PMTILES_TMP_PATH" "$PMTILES_FINAL"
log "  Atomic swap complete: $PMTILES_FINAL"

# ─── Verify ───────────────────────────────────────────────────────────────────
log "--- Verification ---"
pmtiles show "$PMTILES_FINAL" | head -10 | while IFS= read -r line; do
    log "  $line"
done

SIZE=$(du -h "$PMTILES_FINAL" | cut -f1)
log "  File size: $SIZE"

log "============================================================"
log " Build complete: $PMTILES_FINAL"
log ""
log " Next steps:"
log "   - Reload nginx if /charts/ location block is not yet in place"
log "   - Verify in browser at: pmtiles://http://sailboatserver.local/charts/enc.pmtiles"
log "   - See docs/VECTOR_CHARTS.md Step 4 for nginx config"
log "============================================================"
