#!/bin/bash
# ============================================================
# SailboatServer Deploy Script
# Deploys web/, server/, and esphome/ from Mac to Pi
#
# Prerequisites:
#   1. Run once: ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@sailboatserver.local
#      (Enter Pi password when prompted — then no password needed for future deploys)
#   2. Pi must be reachable: ping sailboatserver.local
# ============================================================

set -e
PI_HOST="${PI_HOST:-sailboatserver.local}"
PI_USER="${PI_USER:-pi}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$PROJECT_DIR/web"
REMOTE_WWW="/var/www/html"
REMOTE_HOME="/home/pi"

echo "=========================================="
echo "SailboatServer Deploy → $PI_USER@$PI_HOST"
echo "=========================================="

# SSH key (generated for Cursor/Pi access)
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

# Test SSH connection
echo ""
echo "[1/5] Testing SSH connection..."
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o BatchMode=yes "$PI_USER@$PI_HOST" "echo OK" 2>/dev/null; then
  echo ""
  echo "⚠ SSH connection failed. Run this first (enter Pi password when prompted):"
  echo "   ssh-copy-id -i ${SSH_KEY}.pub pi@sailboatserver.local"
  echo ""
  exit 1
fi
echo "   SSH OK"

# Deploy web files
echo ""
echo "[2/5] Deploying portal and helm to $REMOTE_WWW..."
ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" "sudo mkdir -p $REMOTE_WWW/css $REMOTE_WWW/js $REMOTE_WWW/vendor/leaflet/images $REMOTE_WWW/vendor/maplibre $REMOTE_WWW/vendor/pmtiles"
scp -i "$SSH_KEY" -q "$WEB_DIR/index.html" "$WEB_DIR/helm.html" "$WEB_DIR/crew.html" "$WEB_DIR/chart.html" "$WEB_DIR/library.html" "$WEB_DIR/favicon.svg" "$WEB_DIR/warm.html" "$WEB_DIR/chart-test.html" "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/css/sbs-theme.css" "$WEB_DIR/css/helm.css" "$WEB_DIR/css/crew.css" "$WEB_DIR/css/library.css" "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/js/sbs-data.js" "$WEB_DIR/js/sbs-components.js" \
      "$WEB_DIR/js/sbs-chart.js" "$WEB_DIR/js/sbs-chart-maplibre.js" \
      "$WEB_DIR/js/portal.js" "$WEB_DIR/js/helm.js" "$WEB_DIR/js/crew.js" "$WEB_DIR/js/library.js" "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/vendor/leaflet/leaflet.js" \
      "$WEB_DIR/vendor/leaflet/leaflet.css" \
      "$WEB_DIR/vendor/leaflet-velocity/leaflet-velocity.min.js" \
      "$WEB_DIR/vendor/leaflet-velocity/leaflet-velocity.min.css" \
      "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/vendor/leaflet/images/marker-icon.png" \
      "$WEB_DIR/vendor/leaflet/images/marker-icon-2x.png" \
      "$WEB_DIR/vendor/leaflet/images/marker-shadow.png" "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/vendor/maplibre/maplibre-gl.js" \
      "$WEB_DIR/vendor/maplibre/maplibre-gl.css" "$PI_USER@$PI_HOST:/tmp/"
scp -i "$SSH_KEY" -q "$WEB_DIR/vendor/pmtiles/pmtiles.js" "$PI_USER@$PI_HOST:/tmp/"
V=$(date -u +%Y%m%d%H%M%S)
ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" \
  "sudo cp /tmp/index.html /tmp/helm.html /tmp/crew.html /tmp/chart.html /tmp/library.html /tmp/favicon.svg /tmp/warm.html /tmp/chart-test.html $REMOTE_WWW/ && \
   sudo cp /tmp/sbs-theme.css /tmp/helm.css /tmp/crew.css /tmp/library.css $REMOTE_WWW/css/ && \
   sudo cp /tmp/sbs-data.js /tmp/sbs-components.js /tmp/sbs-chart.js /tmp/sbs-chart-maplibre.js /tmp/portal.js /tmp/helm.js /tmp/crew.js /tmp/library.js $REMOTE_WWW/js/ && \
   sudo cp /tmp/leaflet.js /tmp/leaflet.css $REMOTE_WWW/vendor/leaflet/ && \
   sudo mkdir -p $REMOTE_WWW/vendor/leaflet-velocity && \
   sudo cp /tmp/leaflet-velocity.min.js /tmp/leaflet-velocity.min.css $REMOTE_WWW/vendor/leaflet-velocity/ && \
   sudo cp /tmp/marker-icon.png /tmp/marker-icon-2x.png /tmp/marker-shadow.png $REMOTE_WWW/vendor/leaflet/images/ && \
   sudo cp /tmp/maplibre-gl.js /tmp/maplibre-gl.css $REMOTE_WWW/vendor/maplibre/ && \
   sudo cp /tmp/pmtiles.js $REMOTE_WWW/vendor/pmtiles/ && \
   sudo chown -R www-data:www-data $REMOTE_WWW"
# Cache-bust: update ?v= query strings on the Pi so browsers fetch new assets
ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" \
  "sudo sed -i \
     -e 's/css?v=[0-9A-Za-z]*/css?v=$V/g' \
     -e 's/js?v=[0-9A-Za-z]*/js?v=$V/g' \
     $REMOTE_WWW/index.html $REMOTE_WWW/helm.html $REMOTE_WWW/crew.html $REMOTE_WWW/chart.html $REMOTE_WWW/library.html"
echo "   Web files deployed (cache version: $V)"

# Deploy relay_server — only restart service if file changed (restart causes GPIO float → relays glitch)
echo ""
echo "[3/5] Deploying relay_server.py..."
LOCAL_HASH=$(md5 -q "$PROJECT_DIR/server/relay_server.py" 2>/dev/null || md5sum "$PROJECT_DIR/server/relay_server.py" | cut -d' ' -f1)
REMOTE_HASH=$(ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" "md5sum $REMOTE_HOME/relay_server.py 2>/dev/null | cut -d' ' -f1" || echo "none")
if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  scp -i "$SSH_KEY" -q "$PROJECT_DIR/server/relay_server.py" "$PI_USER@$PI_HOST:$REMOTE_HOME/relay_server.py"
  echo "   relay_server.py deployed (changed — restarting service)"
  echo ""
  echo "[4/5] Installing dependencies and restarting relay service..."
  ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" "sudo pip3 install flask-cors --break-system-packages 2>/dev/null || true; \
    sudo systemctl restart relay.service"
  echo "   Relay service restarted"
else
  echo "   relay_server.py unchanged — skipping restart (relays safe)"
  echo ""
  echo "[4/5] Skipping relay restart (no changes)"
fi

# Deploy setup_enc_wms.py to Pi home directory
echo ""
echo "[4b/5] Deploying setup_enc_wms.py..."
scp -i "$SSH_KEY" -q "$PROJECT_DIR/scripts/setup_enc_wms.py" "$PI_USER@$PI_HOST:$REMOTE_HOME/setup_enc_wms.py"
echo "   setup_enc_wms.py deployed → ~/setup_enc_wms.py"

# Sync ESPHome config to Pi (for OTA flashing without USB)
echo ""
echo "[4c/5] Syncing ESPHome config to Pi ~/esphome/..."
ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" "mkdir -p $REMOTE_HOME/esphome"
scp -i "$SSH_KEY" -q "$PROJECT_DIR/esphome/sv_esperanza_sensors.yaml" "$PROJECT_DIR/esphome/nmea_client.h" "$PI_USER@$PI_HOST:$REMOTE_HOME/esphome/"
if [ -f "$PROJECT_DIR/esphome/secrets.yaml" ]; then
  scp -i "$SSH_KEY" -q "$PROJECT_DIR/esphome/secrets.yaml" "$PI_USER@$PI_HOST:$REMOTE_HOME/esphome/"
fi
echo "   ESPHome config synced → ~/esphome/"
echo "   OTA flash: ssh pi@$PI_HOST 'cd ~/esphome && python3 -m esphome run sv_esperanza_sensors.yaml --no-logs'"

# Verify
echo ""
echo "[5/5] Verifying services..."
ssh -i "$SSH_KEY" "$PI_USER@$PI_HOST" "systemctl is-active --quiet nginx && echo '   nginx: running' || echo '   nginx: NOT running'; \
  systemctl is-active --quiet relay.service && echo '   relay: running' || echo '   relay: NOT running'"

echo ""
echo "=========================================="
echo "✓ Deploy complete!"
echo ""
echo "Portal:  http://sailboatserver.local"
echo "Helm:    http://sailboatserver.local/helm.html"
echo "Crew:    http://sailboatserver.local/crew.html"
echo "Warmer:  http://sailboatserver.local/warm.html"
echo "SignalK: http://sailboatserver.local:3000"
echo ""
echo "To rebuild charts/WMS on the Pi:"
echo "  ssh pi@sailboatserver.local"
echo "  sudo python3 setup_enc_wms.py"
echo "=========================================="
