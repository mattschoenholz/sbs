#!/usr/bin/env node
/**
 * Pre-warm nginx tile cache for MapServer WMS charts.
 *
 * Uses the EXACT same bbox calculation as Leaflet (V8 JavaScript engine),
 * guaranteeing bit-identical URLs so the nginx fastcgi_cache key matches
 * browser requests perfectly.
 *
 * Tile coverage:
 *   Zoom  1-12 : Wide PNW area  (lat 36–58, lon -138 to -120) — fast, ~80k tiles
 *   Zoom 13-15 : ENC data bounds (lat 45.8–49.1, lon -124.7 to -122.3) — ~150k tiles
 *
 * Usage:
 *   node warm_tile_cache.mjs [--max-zoom 15] [--workers 8]
 *   tail -f /tmp/warm_tiles.log
 */

import http from 'http';
import { parseArgs } from 'util';

// ── WMS parameters (must match sbs-chart.js exactly) ────────────────────────
const LAYERS =
  'DEPARE_verydeep,DEPARE_deep,DEPARE_mid,DEPARE_shallow,DEPARE_vshallow,' +
  'DEPARE_drying,DEPARE_neg,SBDARE,LNDARE,DRGARE,DEPCNT,COALNE,SLCONS,' +
  'WRECKS,OBSTRN,UWTROC,SOUNDG';

const LAYERS_ENC = LAYERS.replace(/,/g, '%2C');

// Host: run locally on Mac → requests go to sailboatserver.local over LAN
// This ensures the bbox computation uses the same x86-64 V8 as Chrome (not ARM64 Pi),
// which is required for the nginx cache key to match real browser requests.
const HOST = process.env.TILE_HOST || 'sailboatserver.local';

const URL_PREFIX =
  `http://${HOST}/cgi-bin/mapserv` +
  '?service=WMS' +
  '&request=GetMap' +
  `&layers=${LAYERS_ENC}` +
  '&styles=' +
  '&format=image%2Fpng' +
  '&transparent=true' +
  '&version=1.1.1' +
  '&width=256' +
  '&height=256' +
  '&srs=EPSG%3A3857' +
  '&bbox=';

// ── Geographic bounds ────────────────────────────────────────────────────────
const ENC_BOUNDS  = { xmin: -124.656917, ymin: 45.861477, xmax: -122.292914, ymax: 49.004167 };
const WIDE_BOUNDS = { xmin: -138.0,      ymin: 36.0,      xmax: -120.0,      ymax: 58.0 };
const WIDE_MAX_ZOOM = 12;

// ── Leaflet EPSG:3857 Transformation (bit-identical to browser) ───────────────
// From Leaflet source: transformation: ht(lt=0.5/(Math.PI*R), 0.5, -lt, 0.5)
// untransform: x = (px/scale - _b) / _a,  y = (py/scale - _d) / _c
const R = 6378137.0;
const _a =  0.5 / (Math.PI * R);
const _c = -0.5 / (Math.PI * R);

function tileBbox(z, x, y) {
  const scale = 256 * Math.pow(2, z);
  const xmin = (x * 256 / scale - 0.5) / _a;
  const xmax = ((x + 1) * 256 / scale - 0.5) / _a;
  const ymax = (y * 256 / scale - 0.5) / _c;       // NW = north = larger y
  const ymin = ((y + 1) * 256 / scale - 0.5) / _c; // SE = south = smaller y
  return [xmin, ymin, xmax, ymax];
}

function makeUrl(z, x, y) {
  const [xmin, ymin, xmax, ymax] = tileBbox(z, x, y);
  return `${URL_PREFIX}${xmin},${ymin},${xmax},${ymax}`;
}

// ── Tile coordinate helpers ───────────────────────────────────────────────────
function lonToX(lon, z) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}
function latToY(lat, z) {
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, z);
  return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
}

function* tilesForBounds(bounds, z) {
  const x0 = lonToX(bounds.xmin, z);
  const x1 = lonToX(bounds.xmax, z);
  const y0 = latToY(bounds.ymax, z); // north → smaller y
  const y1 = latToY(bounds.ymin, z); // south → larger y
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      yield [z, x, y];
}

// ── HTTP request with promise ────────────────────────────────────────────────
function fetchTile(z, x, y) {
  return new Promise((resolve) => {
    const url = makeUrl(z, x, y);
    const req = http.get(url, { headers: { 'User-Agent': 'TileWarmer/1.0' } }, (res) => {
      let size = 0;
      res.on('data', (chunk) => { size += chunk.length; });
      res.on('end', () => {
        const cacheStatus = res.headers['x-cache-status'] || '?';
        resolve({ z, x, y, size, cacheStatus, err: null });
      });
    });
    req.setTimeout(300000);
    req.on('error', (e) => resolve({ z, x, y, size: 0, cacheStatus: 'ERR', err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ z, x, y, size: 0, cacheStatus: 'TIMEOUT', err: 'timeout' }); });
  });
}

// ── Self-test: verify bbox matches known tiles from nginx access.log ──────────
function selfTest() {
  const known = [
    [6,  6, 25, [-16280475.528516265, 3757032.8142729844, -15654303.3928041,    4383204.949985149]],
    [6, 12, 22, [-12523442.714243278, 5635549.221409476,  -11897270.578531114,  6261721.357121641]],
    [6, 12, 25, [-12523442.714243278, 3757032.8142729844, -11897270.578531114,  4383204.949985149]],
    [6, 12, 23, [-12523442.714243278, 5009377.085697314,  -11897270.578531114,  5635549.221409476]],
    [6, 12, 20, [-12523442.714243278, 6887893.492833805,  -11897270.578531114,  7514065.628545967]],
  ];
  let allPass = true;
  for (const [z, x, y, expected] of known) {
    const got = tileBbox(z, x, y);
    const match = got.every((v, i) => v === expected[i]);
    if (!match) {
      allPass = false;
      console.log(`MISMATCH z=${z} x=${x} y=${y}`);
      console.log(`  got:    [${got.join(', ')}]`);
      console.log(`  expect: [${expected.join(', ')}]`);
    }
  }
  return allPass;
}

// ── Worker pool (limit concurrent requests to maxWorkers) ────────────────────
async function runWithConcurrency(tiles, maxWorkers, onResult) {
  let idx = 0;
  async function worker() {
    while (idx < tiles.length) {
      const tile = tiles[idx++];
      const result = await fetchTile(...tile);
      onResult(result);
    }
  }
  await Promise.all(Array.from({ length: maxWorkers }, worker));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { values } = parseArgs({
    options: {
      'max-zoom': { type: 'string', default: '15' },
      'workers':  { type: 'string', default: '8' },
      'test':     { type: 'boolean', default: false },
    }
  });

  if (values.test) {
    console.log('Running self-test against nginx access.log tiles...');
    const pass = selfTest();
    console.log(pass ? '✓ All tiles match exactly!' : '✗ Some tiles differ!');
    return;
  }

  const maxZoom   = parseInt(values['max-zoom']);
  const maxWorkers = parseInt(values.workers);

  // Collect all tiles
  const tiles = [];
  const zoomCounts = {};
  for (let z = 1; z <= maxZoom; z++) {
    const bounds = z <= WIDE_MAX_ZOOM ? WIDE_BOUNDS : ENC_BOUNDS;
    let count = 0;
    for (const tile of tilesForBounds(bounds, z)) { tiles.push(tile); count++; }
    zoomCounts[z] = count;
  }

  const total = tiles.length;
  console.log(`\nPre-warming ${total.toLocaleString()} tiles (zoom 1-${maxZoom}, ${maxWorkers} workers)`);
  console.log(`Wide area (zoom 1-${WIDE_MAX_ZOOM}): lon ${WIDE_BOUNDS.xmin}..${WIDE_BOUNDS.xmax}, lat ${WIDE_BOUNDS.ymin}..${WIDE_BOUNDS.ymax}`);
  console.log(`ENC area  (zoom ${WIDE_MAX_ZOOM+1}-${maxZoom}): lon ${ENC_BOUNDS.xmin}..${ENC_BOUNDS.xmax}, lat ${ENC_BOUNDS.ymin}..${ENC_BOUNDS.ymax}`);
  console.log('Zoom breakdown:');
  for (let z = 1; z <= maxZoom; z++) {
    const label = z <= WIDE_MAX_ZOOM ? 'WIDE' : 'ENC ';
    console.log(`  z${String(z).padStart(2)} (${label}): ${String(zoomCounts[z]).padStart(7)} tiles`);
  }
  const estMin = total / maxWorkers / 10;
  if (total > 50000) console.log(`\nEstimated time: ~${(estMin/60).toFixed(0)} hours`);
  console.log(`\nLogging progress every 1000 tiles. Starting...`);

  let done = 0, hit = 0, miss = 0, errors = 0;
  const startMs = Date.now();
  const logLines = [];

  function onResult(r) {
    done++;
    if (r.err) errors++;
    else if (r.cacheStatus.includes('HIT')) hit++;
    else miss++;

    if (done % 1000 === 0 || done === total) {
      const elapsed = (Date.now() - startMs) / 1000;
      const rate = done / elapsed;
      const eta = (total - done) / rate;
      const msg = `  ${done.toLocaleString()}/${total.toLocaleString()} ` +
        `(${(100*done/total).toFixed(1)}%) | ` +
        `HIT=${hit.toLocaleString()} MISS=${miss.toLocaleString()} ERR=${errors} | ` +
        `${rate.toFixed(1)} tiles/s | ETA ${(eta/60).toFixed(0)}m`;
      console.log(msg);
    }
  }

  await runWithConcurrency(tiles, maxWorkers, onResult);

  const elapsed = (Date.now() - startMs) / 1000;
  const summary = `\nDone! ${total.toLocaleString()} tiles in ${(elapsed/60).toFixed(1)} minutes.\n` +
    `Cache hits: ${hit.toLocaleString()} | New tiles: ${miss.toLocaleString()} | Errors: ${errors}`;
  console.log(summary);
}

main().catch(console.error);
