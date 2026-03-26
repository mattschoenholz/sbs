#!/bin/bash
# ============================================================
# SV-Esperanza Chart Setup Script
# Run on the Raspberry Pi to download and install NOAA charts
# for Pacific Northwest waters (Puget Sound, San Juan Islands,
# Strait of Juan de Fuca, Washington/Oregon coast).
#
# What this does:
#   1. Installs OpenCPN (marine chart plotter)
#   2. Installs SignalK charts plugin (serves charts to web portal)
#   3. Downloads NOAA ENCs for Pacific Northwest to NVMe
#   4. Configures chart directories for both OpenCPN and SignalK
#
# Usage:
#   chmod +x setup_charts.sh && ./setup_charts.sh
# ============================================================

set -e

CHART_DIR="/data/charts"          # NVMe storage (fast, plenty of space)
ENC_DIR="$CHART_DIR/noaa_enc"     # NOAA Electronic Navigational Charts (S-57)
LOG="/tmp/setup_charts.log"       # Temp log until chart dir is created

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*" | tee -a "$LOG"; }
warn() { echo -e "${YELLOW}[!]${NC} $*" | tee -a "$LOG"; }
err()  { echo -e "${RED}[✗]${NC} $*" | tee -a "$LOG"; }

echo ""
echo "=============================================="
echo "  SV-Esperanza Chart Setup"
echo "  PNW NOAA Charts + OpenCPN + SignalK"
echo "=============================================="
echo ""

# ── 1. CREATE CHART DIRECTORIES ─────────────────────────────
log "Creating chart directories on NVMe ($CHART_DIR)..."
sudo mkdir -p "$ENC_DIR"
sudo chown -R pi:pi "$CHART_DIR"
LOG="$CHART_DIR/setup.log"       # Switch log to permanent location
cp /tmp/setup_charts.log "$LOG" 2>/dev/null || true

# ── 2. INSTALL OPENCPN ──────────────────────────────────────
log "Installing OpenCPN and plugins..."
sudo apt-get update -qq

# OpenPlotter may already have OpenCPN; use --no-upgrade to be safe
if ! command -v opencpn &>/dev/null; then
  sudo apt-get install -y opencpn
  log "OpenCPN installed"
else
  warn "OpenCPN already installed — skipping"
fi

# Chart Downloader plugin (for future GUI downloads)
sudo apt-get install -y opencpn-plugin-chartdldr 2>/dev/null || \
  warn "opencpn-plugin-chartdldr not in apt — may already be bundled with OpenCPN"

# Grib plugin for weather routing (future use)
sudo apt-get install -y opencpn-plugin-grib 2>/dev/null || \
  warn "opencpn-plugin-grib not available — install manually from OpenCPN plugin manager"

log "OpenCPN setup complete"

# ── 3. CONFIGURE OPENCPN CHART DIRECTORIES ──────────────────
log "Configuring OpenCPN to use chart directory..."
OCPN_CFG="$HOME/.opencpn/opencpn.conf"
mkdir -p "$(dirname $OCPN_CFG)"

# Append chart directory if not already there
if [ -f "$OCPN_CFG" ]; then
  if ! grep -q "$ENC_DIR" "$OCPN_CFG"; then
    # Find or create the [ChartDirectories] section
    python3 - <<PYEOF
import configparser, os
cfg = configparser.ConfigParser(strict=False)
cfg.read("$OCPN_CFG")
if not cfg.has_section("ChartDirectories"):
    cfg.add_section("ChartDirectories")
n = sum(1 for k in cfg.options("ChartDirectories") if k.startswith("dir")) + 1
cfg.set("ChartDirectories", f"Dir{n:04d}", "$ENC_DIR")
with open("$OCPN_CFG", "w") as f:
    cfg.write(f)
print("  Chart directory added to opencpn.conf")
PYEOF
  else
    warn "OpenCPN config already includes $ENC_DIR"
  fi
else
  # Create minimal config
  cat > "$OCPN_CFG" <<CONFEOF
[ChartDirectories]
Dir0001=$ENC_DIR
CONFEOF
  log "Created opencpn.conf with chart directory"
fi

# ── 4. INSTALL SIGNALK CHARTS PLUGIN ────────────────────────
log "Installing SignalK charts plugin (@signalk/charts-plugin)..."
SK_DIR="$HOME/.signalk"
if [ -d "$SK_DIR" ]; then
  cd "$SK_DIR"
  if npm list @signalk/charts-plugin &>/dev/null 2>&1; then
    warn "SignalK charts plugin already installed"
  else
    npm install @signalk/charts-plugin 2>&1 | tail -5
    log "SignalK charts plugin installed"
  fi

  # Tell charts plugin where to find our charts
  PLUGIN_CFG="$SK_DIR/plugin-config-data/charts.json"
  mkdir -p "$(dirname $PLUGIN_CFG)"
  if [ ! -f "$PLUGIN_CFG" ]; then
    cat > "$PLUGIN_CFG" <<JSON
{
  "chartPath": "$CHART_DIR"
}
JSON
    log "SignalK charts plugin configured: chartPath=$CHART_DIR"
  else
    warn "Plugin config already exists at $PLUGIN_CFG — check chartPath manually"
  fi
else
  warn "SignalK directory not found at $SK_DIR — skipping charts plugin install"
  warn "Install SignalK first, then re-run this script"
fi

# ── 5. DOWNLOAD NOAA ENCs FOR PACIFIC NORTHWEST ─────────────
log "Downloading NOAA ENCs for Pacific Northwest..."
log "Charts go to: $ENC_DIR"
echo ""

# NOAA ENC download URL pattern:
#   https://charts.noaa.gov/ENCs/{CHART_ID}.zip
# Chart IDs for Pacific Northwest waters:
#   Scale 1 (overview):   US1WA03M
#   Scale 3 (coastal):    US3WA20M (Washington), US3OR20M (Oregon)
#   Scale 4 (approach):   US4WA20M, US4WA22M
#   Scale 5 (harbor):     US5WA21M-US5WA29M (Puget Sound, San Juans, etc.)
#                         US5OR10M-US5OR15M (Oregon coast, Columbia River)

PNW_CHARTS=(
  # Strait of Juan de Fuca / entrance
  "US5WA21M"   # Strait of Juan de Fuca — western approach
  "US5WA22M"   # Strait of Juan de Fuca — central
  "US5WA23M"   # San Juan Islands
  "US5WA24M"   # Rosario / Bellingham / Anacortes area

  # Puget Sound — northern
  "US5WA25M"   # Puget Sound — Saratoga Passage / Everett (if available)
  "US5WA26M"   # Puget Sound — Seattle / Bainbridge / Port Orchard
  "US5WA27M"   # Puget Sound — central (Tacoma Narrows)
  "US5WA28M"   # Puget Sound — southern (Olympia)
  "US5WA29M"   # Hood Canal
  "US5WA30M"   # Additional Washington waters
  "US5WA31M"   # Additional Washington waters
  "US5WA32M"   # Additional Washington waters
  "US5WA33M"   # Additional Washington waters

  # Oregon coast / Columbia River
  "US5OR11M"   # Columbia River (lower)
  "US5OR12M"   # Oregon coast north
  "US5OR13M"   # Oregon coast south

  # Note: Scale 1-4 overview charts (US1/US3/US4) use a different NOAA
  # download path — these are included in the online NOAA tile service used
  # by the web portal. Use OpenCPN chart downloader for large-scale overviews.
)

NOAA_BASE="https://charts.noaa.gov/ENCs"
downloaded=0
skipped=0
failed=0

for chart_id in "${PNW_CHARTS[@]}"; do
  zip_file="$ENC_DIR/${chart_id}.zip"
  url="$NOAA_BASE/${chart_id}.zip"

  if [ -d "$ENC_DIR/${chart_id}" ]; then
    warn "  $chart_id — already extracted, skipping"
    ((skipped++)) || true
    continue
  fi

  printf "  Downloading %-12s ... " "$chart_id"
  if curl -sfL --connect-timeout 15 --max-time 120 \
      -o "$zip_file" "$url" 2>>"$LOG"; then
    # Extract the zip
    unzip -q -o "$zip_file" -d "$ENC_DIR/${chart_id}/" 2>>"$LOG" || true
    rm -f "$zip_file"
    echo -e "${GREEN}OK${NC}"
    ((downloaded++)) || true
  else
    echo -e "${YELLOW}NOT FOUND${NC} (chart may not exist at this scale)"
    rm -f "$zip_file"
    ((failed++)) || true
  fi
done

echo ""
log "Download complete: $downloaded downloaded, $skipped skipped, $failed not found"

# ── 6. RESTART SIGNALK ───────────────────────────────────────
if systemctl is-active --quiet signalk 2>/dev/null; then
  log "Restarting SignalK to load charts plugin..."
  sudo systemctl restart signalk
  sleep 3
  if systemctl is-active --quiet signalk; then
    log "SignalK restarted successfully"
  else
    warn "SignalK restart may have failed — check: sudo systemctl status signalk"
  fi
else
  warn "SignalK service not running — start with: sudo systemctl start signalk"
fi

# ── 7. INSTALL CANADIAN CHARTS (OPTIONAL) ───────────────────
echo ""
echo "──────────────────────────────────────────────"
echo "  OPTIONAL: Canadian Charts (BC Waters)"
echo "──────────────────────────────────────────────"
echo "  Canadian Hydrographic Service (CHS) provides free ENCs for BC waters."
echo "  Download from: https://open.canada.ca/data/en/dataset/a6a0493e-9001-4a4d-b80e-f5e5f4b47bfc"
echo "  Or via OpenCPN chart downloader: Chart Catalog → Canada"
echo ""

# ── 8. SUMMARY ──────────────────────────────────────────────
echo ""
echo "=============================================="
log "Chart setup complete!"
echo ""
echo "  Charts location:    $ENC_DIR"
echo "  SignalK charts API: http://localhost:3000/signalk/v1/api/resources/charts"
echo "  OpenCPN config:     $OCPN_CFG"
echo ""
echo "  Next steps:"
echo "  1. Open the portal Charts tab — tap NOAA/SK button to cycle sources"
echo "  2. When SignalK charts plugin detects ENCs, the button shows 'SK'"
echo "     (SignalK converts S-57 ENCs to tile format automatically)"
echo "  3. Launch OpenCPN for full-featured chart plotter:"
echo "     DISPLAY=:0 opencpn &   (from Pi desktop)"
echo "     Or enable VNC: sudo raspi-config → Interface → VNC → Enable"
echo ""
echo "  For additional charts (Canada, Alaska, Mexico):"
echo "  • OpenCPN plugin manager: Tools → Plugin Manager → Chart Downloader"
echo "  • OpenCPN downloads to: $ENC_DIR (already configured)"
echo "=============================================="
