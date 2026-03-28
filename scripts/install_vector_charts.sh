#!/usr/bin/env bash
# install_vector_charts.sh — Install vector chart pipeline tools on Raspberry Pi 5 (arm64, Bookworm)
#
# Installs:
#   - tippecanoe (built from source — no arm64 package available)
#   - pmtiles CLI (arm64 binary from go-pmtiles releases)
#   - MapLibre GL JS + pmtiles.js downloaded to /var/www/html/lib/ for offline use
#
# Usage:
#   sudo bash install_vector_charts.sh
#
# Idempotent: safe to re-run; skips steps already completed.

set -euo pipefail

PMTILES_VER="1.30.1"
MAPLIBRE_VER="5.21.1"
LIB_DIR="/var/www/html/lib"
TIPPECANOE_SRC="$HOME/tippecanoe"

# ─── helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] OK: $*"; }
skip() { echo "[$(date '+%H:%M:%S')] SKIP: $*"; }
die()  { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; exit 1; }

require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (sudo bash $0)"
    fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Section 1 — Build deps + tippecanoe from source
# ──────────────────────────────────────────────────────────────────────────────
install_tippecanoe() {
    log "=== Section 1: tippecanoe ==="

    if command -v tippecanoe &>/dev/null; then
        skip "tippecanoe already installed: $(tippecanoe --version 2>&1 | head -1)"
        return 0
    fi

    log "Installing build dependencies..."
    apt-get install -y gcc g++ make libsqlite3-dev zlib1g-dev git

    if [[ -d "$TIPPECANOE_SRC" ]]; then
        log "tippecanoe source directory already exists at $TIPPECANOE_SRC — pulling latest..."
        git -C "$TIPPECANOE_SRC" pull --ff-only
    else
        log "Cloning tippecanoe from GitHub..."
        git clone https://github.com/felt/tippecanoe.git "$TIPPECANOE_SRC"
    fi

    log "Building tippecanoe (this takes 2–3 minutes on Pi 5)..."
    make -j4 -C "$TIPPECANOE_SRC"

    log "Installing tippecanoe to /usr/local/bin..."
    make -C "$TIPPECANOE_SRC" install

    ok "tippecanoe installed: $(tippecanoe --version 2>&1 | head -1)"
}

# ──────────────────────────────────────────────────────────────────────────────
# Section 2 — pmtiles CLI (arm64 binary)
# ──────────────────────────────────────────────────────────────────────────────
install_pmtiles() {
    log "=== Section 2: pmtiles CLI ==="

    if command -v pmtiles &>/dev/null; then
        skip "pmtiles already installed: $(pmtiles --version 2>&1 | head -1)"
        return 0
    fi

    local tarball="/tmp/go-pmtiles_${PMTILES_VER}_Linux_arm64.tar.gz"
    local url="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VER}/go-pmtiles_${PMTILES_VER}_Linux_arm64.tar.gz"

    log "Downloading pmtiles v${PMTILES_VER} (arm64)..."
    wget -q --show-progress "$url" -O "$tarball"

    log "Extracting pmtiles binary..."
    tar xf "$tarball" -C /tmp/

    if [[ ! -f /tmp/pmtiles ]]; then
        # Some releases nest the binary differently
        local found
        found=$(find /tmp -maxdepth 3 -name 'pmtiles' -type f 2>/dev/null | head -1)
        [[ -n "$found" ]] || die "pmtiles binary not found after extraction"
        cp "$found" /tmp/pmtiles
    fi

    mv /tmp/pmtiles /usr/local/bin/pmtiles
    chmod +x /usr/local/bin/pmtiles
    rm -f "$tarball"

    ok "pmtiles installed: $(pmtiles --version 2>&1 | head -1)"
}

# ──────────────────────────────────────────────────────────────────────────────
# Section 3 — Verify both tools
# ──────────────────────────────────────────────────────────────────────────────
verify_tools() {
    log "=== Section 3: verification ==="

    local all_ok=1

    if command -v tippecanoe &>/dev/null; then
        ok "tippecanoe: $(tippecanoe --version 2>&1 | head -1)"
    else
        echo "FAIL: tippecanoe not found in PATH" >&2
        all_ok=0
    fi

    if command -v pmtiles &>/dev/null; then
        ok "pmtiles: $(pmtiles --version 2>&1 | head -1)"
    else
        echo "FAIL: pmtiles not found in PATH" >&2
        all_ok=0
    fi

    if [[ $all_ok -eq 0 ]]; then
        die "One or more tools failed to install."
    fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Section 4 — Download MapLibre GL JS + pmtiles.js for offline use
# ──────────────────────────────────────────────────────────────────────────────
install_frontend_libs() {
    log "=== Section 4: frontend libs → $LIB_DIR ==="

    mkdir -p "$LIB_DIR"

    declare -A LIBS=(
        ["maplibre-gl.js"]="https://unpkg.com/maplibre-gl@${MAPLIBRE_VER}/dist/maplibre-gl.js"
        ["maplibre-gl.css"]="https://unpkg.com/maplibre-gl@${MAPLIBRE_VER}/dist/maplibre-gl.css"
        ["pmtiles.js"]="https://unpkg.com/pmtiles/dist/pmtiles.js"
    )

    for filename in "${!LIBS[@]}"; do
        local dest="$LIB_DIR/$filename"
        if [[ -f "$dest" ]]; then
            skip "$filename already present at $dest"
            continue
        fi
        log "Downloading $filename..."
        wget -q --show-progress "${LIBS[$filename]}" -O "$dest"
        ok "$filename → $dest"
    done

    log "Setting permissions on $LIB_DIR..."
    chown -R www-data:www-data "$LIB_DIR" 2>/dev/null || true
    chmod -R 644 "$LIB_DIR"/*.js "$LIB_DIR"/*.css 2>/dev/null || true
    chmod 755 "$LIB_DIR"

    ok "Frontend libs installed."
}

# ──────────────────────────────────────────────────────────────────────────────
# Section 5 — Ensure /data/charts exists with correct permissions
# ──────────────────────────────────────────────────────────────────────────────
ensure_data_dirs() {
    log "=== Section 5: data directories ==="

    mkdir -p /data/charts/noaa_enc
    chown -R pi:pi /data/charts 2>/dev/null || true
    chmod -R 755 /data/charts

    ok "/data/charts directory ready."
}

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
main() {
    require_root

    log "============================================================"
    log " SailboatServer — Vector Chart Pipeline Install"
    log " Pi 5 / arm64 / Raspberry Pi OS Bookworm"
    log "============================================================"

    install_tippecanoe
    install_pmtiles
    verify_tools
    install_frontend_libs
    ensure_data_dirs

    log "============================================================"
    log " All done."
    log ""
    log " Next steps:"
    log "   1. Download NOAA ENC charts:  python3 scripts/update_enc.py"
    log "   2. Or manually trigger build:  bash scripts/build_pmtiles.sh"
    log "   3. Add nginx /charts/ location block (see docs/VECTOR_CHARTS.md Step 4)"
    log "   4. Download fonts for sounding labels (see docs/VECTOR_CHARTS.md Step 5)"
    log "============================================================"
}

main "$@"
