# Vector Chart Pipeline — PMTiles + MapLibre

**Status:** Planned (P2) — replaces MapServer WMS raster pipeline
**Researched:** March 2026

---

## Architecture

```
S-57 files → ogr2ogr (GPKG) → tippecanoe (MBTiles) → pmtiles convert → enc.pmtiles
                                                                              ↓
nginx (static, range requests) ← pmtiles.js ← MapLibre GL JS (browser WebGL)
```

**Key wins over current MapServer setup:**
- Eliminates bbox floating-point cache key problem (warm.html becomes unnecessary)
- Pi server load: near-zero (just serving file bytes) vs high (MapServer rendering)
- No fcgiwrap workers needed
- PMTiles file is portable (USB backup)
- Smooth zoom, no tile seams, fully stylizable

---

## Step 1 — Install tippecanoe on Pi (build from source — no arm64 package)

```bash
sudo apt-get install -y gcc g++ make libsqlite3-dev zlib1g-dev git
git clone https://github.com/felt/tippecanoe.git ~/tippecanoe
cd ~/tippecanoe
make -j4
sudo make install
tippecanoe --version
```
~2–3 minutes on Pi 5. No arm64-specific issues.

---

## Step 2 — Install pmtiles CLI (arm64 binary available)

```bash
PMTILES_VER="1.30.1"
wget -q "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VER}/go-pmtiles_${PMTILES_VER}_Linux_arm64.tar.gz" -O /tmp/go-pmtiles.tar.gz
tar xf /tmp/go-pmtiles.tar.gz -C /tmp/
sudo mv /tmp/pmtiles /usr/local/bin/
pmtiles --version
```

---

## Step 3 — Convert enc_merged.gpkg → enc.pmtiles

```bash
# Export each layer as GeoJSONSeq
for layer in DEPARE DEPCNT SOUNDG LNDARE COALNE SBDARE WRECKS OBSTRN UWTROC SLCONS DRGARE; do
  ogr2ogr -f GeoJSONSeq /tmp/enc_${layer}.geojsonl \
    /data/charts/enc_merged.gpkg ${layer} \
    -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6
done

# Run tippecanoe
tippecanoe \
  --output=/tmp/enc.mbtiles \
  --minimum-zoom=8 --maximum-zoom=16 \
  --no-tile-compression \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  --layer=DEPARE  /tmp/enc_DEPARE.geojsonl \
  --layer=DEPCNT  /tmp/enc_DEPCNT.geojsonl \
  --layer=SOUNDG  /tmp/enc_SOUNDG.geojsonl \
  --layer=LNDARE  /tmp/enc_LNDARE.geojsonl \
  --layer=COALNE  /tmp/enc_COALNE.geojsonl \
  --layer=SBDARE  /tmp/enc_SBDARE.geojsonl \
  --layer=WRECKS  /tmp/enc_WRECKS.geojsonl \
  --layer=OBSTRN  /tmp/enc_OBSTRN.geojsonl \
  --layer=UWTROC  /tmp/enc_UWTROC.geojsonl \
  --layer=SLCONS  /tmp/enc_SLCONS.geojsonl \
  --layer=DRGARE  /tmp/enc_DRGARE.geojsonl

# Convert MBTiles → PMTiles (atomic, replaces live file)
pmtiles convert /tmp/enc.mbtiles /data/charts/enc.pmtiles
pmtiles show /data/charts/enc.pmtiles
```

**Key flags:**
- `--no-tile-compression` — tiles must not be double-gzipped (nginx does range requests)
- `--drop-densest-as-needed` — drops densest features at low zooms (appropriate for soundings at z8)
- Do NOT use `--simplification` — nautical hazards need precise geometry

**Estimated output:** 40–80MB for PNW coverage at z8–z16. Conversion: ~10 min on Pi 5.

---

## Step 4 — nginx config for PMTiles

Add to `/etc/nginx/sites-available/default` inside `server {}`:

```nginx
location /charts/ {
    alias /data/charts/;
    add_header Accept-Ranges bytes;
    add_header Access-Control-Allow-Origin "*";
    add_header Access-Control-Allow-Headers "Range";
    gzip off;  # CRITICAL: PMTiles is pre-compressed; nginx gzip corrupts range offsets
    add_header Cache-Control "public, max-age=3600";
    location ~* \.pmtiles$ {
        add_header Content-Type application/x-protomaps;
    }
}
```

---

## Step 5 — Frontend (MapLibre + PMTiles)

Download to Pi for offline use:
```bash
cd /var/www/html/lib/
wget https://unpkg.com/maplibre-gl@5.21.1/dist/maplibre-gl.js
wget https://unpkg.com/maplibre-gl@5.21.1/dist/maplibre-gl.css
wget https://unpkg.com/pmtiles/dist/pmtiles.js
```

Browser initialization:
```javascript
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile.bind(protocol));

const map = new maplibregl.Map({
  container: 'chart-map',
  style: {
    version: 8,
    sources: {
      'enc': {
        type: 'vector',
        url: 'pmtiles://http://sailboatserver.local/charts/enc.pmtiles',
      },
      'esri-ocean': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 13,
      }
    },
    layers: [
      { id: 'esri-base', type: 'raster', source: 'esri-ocean' },
      { id: 'land', type: 'fill', source: 'enc', 'source-layer': 'LNDARE',
        paint: { 'fill-color': '#f7f3e3' } },
      { id: 'depare-deep', type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
        filter: ['>=', ['get', 'DRVAL1'], 20],
        paint: { 'fill-color': '#b8d0e8', 'fill-opacity': 0.8 } },
      { id: 'depare-mid', type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
        filter: ['all', ['>=', ['get', 'DRVAL1'], 5], ['<', ['get', 'DRVAL1'], 20]],
        paint: { 'fill-color': '#cde3f0', 'fill-opacity': 0.8 } },
      { id: 'depare-shallow', type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
        filter: ['<', ['get', 'DRVAL1'], 5],
        paint: { 'fill-color': '#d9eef7', 'fill-opacity': 0.9 } },
      { id: 'depcnt', type: 'line', source: 'enc', 'source-layer': 'DEPCNT',
        paint: { 'line-color': '#5a7f9b', 'line-width': 0.8 } },
      { id: 'coalne', type: 'line', source: 'enc', 'source-layer': 'COALNE',
        paint: { 'line-color': '#333333', 'line-width': 1.5 } },
      { id: 'wrecks', type: 'circle', source: 'enc', 'source-layer': 'WRECKS',
        paint: { 'circle-color': '#cc0000', 'circle-radius': 4 } },
      { id: 'uwtroc', type: 'circle', source: 'enc', 'source-layer': 'UWTROC',
        paint: { 'circle-color': '#cc0000', 'circle-radius': 3 } },
      { id: 'obstrn', type: 'circle', source: 'enc', 'source-layer': 'OBSTRN',
        paint: { 'circle-color': '#994400', 'circle-radius': 3 } },
      // Soundings at z14+ — requires local glyphs endpoint (see below)
      { id: 'soundg', type: 'symbol', source: 'enc', 'source-layer': 'SOUNDG',
        minzoom: 14,
        layout: { 'text-field': ['get', 'VALSOU'], 'text-size': 10 },
        paint: { 'text-color': '#2255aa' } },
    ],
    glyphs: 'http://sailboatserver.local/fonts/{fontstack}/{range}.pbf',
  },
  center: [-122.3, 47.6], zoom: 11,
});
```

**Glyphs for sounding labels (offline):**
Download from `https://github.com/openmaptiles/fonts`, copy PBF files to `/var/www/html/fonts/`.
Or skip sounding text labels initially and render as circles.

---

## Step 6 — Auto-Update Script

PNW chart IDs:
- `US3WA15M` — Puget Sound north
- `US3WA16M` — Puget Sound south
- `US3WA17M` — San Juan Islands
- `US3WA20M` — Strait of Juan de Fuca
- `US4WA01M` — Port Townsend harbor

Update approach: HTTP HEAD check → download ZIP if Last-Modified/ETag changed → rebuild GPKG (existing `setup_enc_wms.py`) → rebuild PMTiles → atomic swap.

Script outline: `scripts/update_enc.py` (to be written).
Cron: `0 3 * * 0 python3 /home/pi/scripts/update_enc.py` (weekly, 3am Sunday).

---

## Gotchas

1. **SOUNDG depth attribute** — may be `DEPTH`, `VALSOU`, or Z coordinate. Check with `ogrinfo /data/charts/enc_merged.gpkg SOUNDG | head -50` before writing style.
2. **DEPARE attributes** — `DRVAL1`/`DRVAL2` encode depth range. Verify present in GPKG before writing filter expressions.
3. **No drop-in nautical style exists** — must write ~100 lines of MapLibre style JSON. Use `LOCAL_WMS_LAYERS` in `sbs-chart.js` as the layer list.
4. **MapLibre vs Leaflet** — don't try to run both on the same map div. Full replacement recommended. AIS markers and boat position become GeoJSON sources updated dynamically.
5. **`--no-tile-compression` + `gzip off`** — both required or range requests will fail.
6. **MapServer can stay in parallel** — add `local-vector` option to `BASE_SRCS`, keep WMS as fallback during migration.

---

## IHO S-52 Reference Colors

| Feature | Color |
|---|---|
| Deep water | `#b8d0e8` |
| Shallow water (0–2m) | `#d4eeff` |
| Drying area | `#9ecf9e` |
| Land | `#f7f3e3` |
| Depth contours | `#5a7f9b` |
| Soundings text | `#222222` |
| Hazards | `#cc0000` |
