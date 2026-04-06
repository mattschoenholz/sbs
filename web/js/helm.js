/* Helm-specific logic — runs after sbs-data.js and sbs-components.js */

// ── HELM CHART ─────────────────────────────────────────────
const HelmChart = (() => {
  const HOST = window.location.hostname || '192.168.42.201';

  // Keep in sync with warm.html and sbs-chart.js LOCAL_WMS_LAYERS
  const LOCAL_WMS_LAYERS = [
    'DEPARE_verydeep','DEPARE_deep','DEPARE_mid',
    'DEPARE_shallow','DEPARE_vshallow','DEPARE_drying','DEPARE_neg',
    'SBDARE','LNDARE','DRGARE',
    'DEPCNT','COALNE','SLCONS',
    'WRECKS','OBSTRN','UWTROC','SOUNDG',
  ].join(',');

  let map = null, boatMarker = null, aisMarkers = {}, passageLayer = null;
  let initialized = false, lastCog = null;

  function makeBoatIcon(cog) {
    const a = cog != null ? cog : 0;
    return L.divIcon({
      className: '',
      html: `<svg width="24" height="24" viewBox="-12 -12 24 24" style="transform:rotate(${a}deg);overflow:visible">
        <polygon points="0,-10 7,8 0,4 -7,8" fill="#e8940a" stroke="#080c10" stroke-width="1.5"/>
      </svg>`,
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    const pos = SBSData.position;
    const center = pos ? [pos.latitude, pos.longitude] : [47.6, -122.3];

    map = L.map('helm-map', { center, zoom: 13, zoomControl: true, attributionControl: false });

    map.createPane('hBasePane'); map.getPane('hBasePane').style.zIndex = 200;
    map.createPane('hWmsPane');  map.getPane('hWmsPane').style.zIndex  = 250;
    map.createPane('hOverPane'); map.getPane('hOverPane').style.zIndex = 300;

    // ESRI underlay — always on
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 13, maxZoom: 18, pane: 'hBasePane' }
    ).addTo(map);

    // Local NOAA ENC WMS
    L.tileLayer.wms(`http://${HOST}/cgi-bin/mapserv`, {
      layers: LOCAL_WMS_LAYERS, styles: '', format: 'image/png',
      transparent: true, version: '1.1.1', pane: 'hWmsPane',
    }).addTo(map);

    passageLayer = L.layerGroup().addTo(map);
    boatMarker = L.marker(center, { icon: makeBoatIcon(SBSData.cog), pane: 'hOverPane', zIndexOffset: 1000 }).addTo(map);

    update();
  }

  function invalidate() {
    if (map) setTimeout(() => map.invalidateSize(), 100);
  }

  function update() {
    if (!map) return;

    // Boat position and heading icon
    const pos = SBSData.position;
    if (pos) {
      const ll = [pos.latitude, pos.longitude];
      boatMarker.setLatLng(ll);
      if (SBSData.cog !== lastCog) {
        boatMarker.setIcon(makeBoatIcon(SBSData.cog));
        lastCog = SBSData.cog;
      }
    }

    // AIS targets
    const vessels = SBSData.aisVessels;
    const seen = new Set();
    Object.entries(vessels).forEach(([ctx, v]) => {
      if (v.lat == null || v.lon == null) return;
      seen.add(ctx);
      const ll = [v.lat, v.lon];
      if (aisMarkers[ctx]) {
        aisMarkers[ctx].setLatLng(ll);
      } else {
        aisMarkers[ctx] = L.circleMarker(ll, {
          radius: 5, color: '#06b6d4', fillColor: '#06b6d4',
          fillOpacity: 0.7, weight: 1, pane: 'hOverPane',
        }).bindPopup(`<b>${v.name || ctx.split(':').pop()}</b><br>SOG: ${v.sog != null ? v.sog.toFixed(1) : '—'} kn`)
          .addTo(map);
      }
    });
    Object.keys(aisMarkers).forEach(ctx => {
      if (!seen.has(ctx)) { map.removeLayer(aisMarkers[ctx]); delete aisMarkers[ctx]; }
    });

    // Passage route line
    passageLayer.clearLayers();
    const p = SBSData.passage;
    if (p.active && p.waypoints.length >= 2) {
      const lls = p.waypoints.map(wp => [wp.lat, wp.lon]);
      L.polyline(lls, { color: '#e8940a', weight: 2, opacity: 0.6, dashArray: '6 4', pane: 'hOverPane' })
        .addTo(passageLayer);
      const nwp = p.waypoints[p.nextWPIndex];
      if (nwp) {
        L.circleMarker([nwp.lat, nwp.lon], {
          radius: 7, color: '#e8940a', fillColor: 'transparent', weight: 2, pane: 'hOverPane',
        }).addTo(passageLayer);
      }
    }
  }

  return { init, invalidate, update };
})();

// ── TAB SWITCHING ─────────────────────────────────────────
document.querySelectorAll('.helm-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.helm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.helm-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    if (tab.dataset.tab === 'chart') {
      // rAF x2 ensures browser has laid out the panel before Leaflet reads container size
      requestAnimationFrame(() => requestAnimationFrame(() => {
        HelmChart.init();
        HelmChart.invalidate();
      }));
    }
  });
});

// ── INSTRUMENT UPDATES ────────────────────────────────────
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

SBSData.on('update', () => {
  setVal('v-sog',  SBSData.fmt(SBSData.sog,     1));
  setVal('v-cog',  SBSData.fmtBearing(SBSData.cog));
  setVal('v-stw',  SBSData.fmt(SBSData.stw,     1));
  setVal('v-tws',  SBSData.fmt(SBSData.tws,     1));
  setVal('v-twd',  SBSData.fmtBearing(SBSData.twd));

  const d = SBSData.depth;
  setVal('v-depth', SBSData.fmt(d, 1));
  const dt = document.getElementById('tile-depth');
  if (dt) {
    dt.classList.toggle('alert-urgent',   d != null && d < 1);
    dt.classList.toggle('alert-advisory', d != null && d >= 1 && d < 3);
  }

  if (!apEngaged) {
    apTarget = SBSData.heading != null ? Math.round(SBSData.heading) : apTarget;
    const aph = document.getElementById('v-ap-hdg');
    if (aph) aph.textContent = apTarget != null ? apTarget + '°' : '---°';
  }
  apUpdateContext();

  setText('chart-sog',   `SOG  ${SBSData.fmt(SBSData.sog, 1)} kn`);
  setText('chart-cog',   `COG  ${SBSData.fmtBearing(SBSData.cog)}`);
  setText('chart-depth', `DEPTH  ${SBSData.fmt(SBSData.depth, 1)} m`);
  setText('chart-tws',   `TWS  ${SBSData.fmt(SBSData.tws, 1)} kn`);
  setText('chart-twd',   `TWD  ${SBSData.fmtBearing(SBSData.twd)}`);
  const pos = SBSData.position;
  if (pos) {
    const coord = SBSData.fmtCoord(pos.latitude, pos.longitude);
    setText('chart-pos',   coord);
    setText('chart-coord', coord);
  }

  setVal('wx-tws',  SBSData.fmt(SBSData.tws, 1));
  setVal('wx-twd',  SBSData.fmtBearing(SBSData.twd));
  setVal('wx-aws',  SBSData.fmt(SBSData.aws, 1));
  setVal('wx-baro', SBSData.fmt(SBSData.pressure, 1));
  setVal('wx-temp', SBSData.fmt(SBSData.temp, 1));
  setVal('wx-hum',  SBSData.fmt(SBSData.humidity, 0));

  updateBaroHistory();
  updatePassageTab();
  HelmChart.update();
});

// ── AUTOPILOT STATE ───────────────────────────────────────
let apEngaged = false;
let apTarget  = null;

async function apToggle() {
  const btn  = document.getElementById('ap-engage-btn');
  const tile = document.getElementById('tile-ap');
  if (apEngaged) {
    // Disengage
    try { await fetch(`${RELAY_URL}/autopilot/heading/disengage`, { method: 'POST' }); } catch(_) {}
    apEngaged = false;
    apTarget  = null;
    if (btn)  { btn.textContent = 'STBY'; btn.classList.remove('active'); }
    if (tile) tile.classList.remove('ap-engaged');
    const err = document.getElementById('ap-hdg-err');
    if (err) err.textContent = '';
    const aph = document.getElementById('v-ap-hdg');
    if (aph) aph.textContent = '---°';
  } else {
    // Engage at current heading
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
      const r = await fetch(`${RELAY_URL}/autopilot/heading/engage`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (r.ok && d.heading != null) {
        apEngaged = true;
        apTarget  = Math.round(d.heading);
        if (btn)  { btn.textContent = 'ENGAGED'; btn.classList.add('active'); }
        if (tile) tile.classList.add('ap-engaged');
        const aph = document.getElementById('v-ap-hdg');
        if (aph) aph.textContent = apTarget + '°';
      } else {
        if (btn) btn.textContent = 'ERROR';
        setTimeout(() => { if (btn) btn.textContent = 'STBY'; }, 2000);
      }
    } catch(_) {
      if (btn) btn.textContent = 'STBY';
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}

async function apAdjust(delta) {
  if (!apEngaged) return;
  try {
    const r = await fetch(`${RELAY_URL}/autopilot/heading/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    const d = await r.json();
    if (r.ok && d.heading != null) {
      apTarget = Math.round(d.heading);
      const aph = document.getElementById('v-ap-hdg');
      if (aph) aph.textContent = apTarget + '°';
    }
  } catch(_) {}
}

function apUpdateContext() {
  // Heading error (target vs COG) — only meaningful when engaged
  if (apEngaged && apTarget != null && SBSData.cog != null) {
    let err = ((SBSData.cog - apTarget + 540) % 360) - 180;
    const errEl = document.getElementById('ap-hdg-err');
    if (errEl) {
      errEl.textContent = (err >= 0 ? '+' : '') + Math.round(err) + '° COG';
      errEl.style.color = Math.abs(err) > 10 ? 'var(--c-yellow)' : 'var(--t-muted)';
    }
  }
  // Destination name from active passage
  const destEl = document.getElementById('ap-dest');
  if (destEl) {
    const p  = SBSData.passage;
    const wp = p.active && p.waypoints.length ? p.waypoints[p.nextWPIndex] : null;
    destEl.textContent = wp ? (wp.name || `WP ${p.nextWPIndex + 1}`) : '';
  }
}

// ── BARO HISTORY ──────────────────────────────────────────
const baroHistory = [];
const BARO_MAX_PTS = 60;
let lastBaroPush = 0;

function updateBaroHistory() {
  const now = Date.now();
  if (SBSData.pressure != null && now - lastBaroPush > 60000) {
    baroHistory.push({ t: now, p: SBSData.pressure });
    if (baroHistory.length > BARO_MAX_PTS) baroHistory.shift();
    lastBaroPush = now;
    updateBaroTrend();
    drawBaroChart();
  }
}

function updateBaroTrend() {
  if (baroHistory.length < 6) return;
  const recent = baroHistory.slice(-6);
  const delta  = recent[recent.length-1].p - recent[0].p;
  const arrow  = document.getElementById('baro-trend');
  const lbl    = document.getElementById('baro-trend-lbl');
  if (delta > 1)       { arrow.textContent='↑'; arrow.className='trend-arrow trend-rising';  lbl.textContent='Rising'; }
  else if (delta < -1) { arrow.textContent='↓'; arrow.className='trend-arrow trend-falling'; lbl.textContent='Falling'; }
  else                 { arrow.textContent='→'; arrow.className='trend-arrow trend-steady';  lbl.textContent='Steady'; }
}

function drawBaroChart() {
  const canvas = document.getElementById('baro-chart');
  if (!canvas || baroHistory.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth  || 200;
  const H = canvas.offsetHeight || 60;
  canvas.width  = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const vals = baroHistory.map(b => b.p);
  const min  = Math.min(...vals) - 2;
  const max  = Math.max(...vals) + 2;
  const xStep = W / (baroHistory.length - 1);

  ctx.beginPath();
  ctx.strokeStyle = '#e8940a';
  ctx.lineWidth   = 1.5;
  baroHistory.forEach((b, i) => {
    const x = i * xStep;
    const y = H - ((b.p - min) / (max - min)) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = 'rgba(232,148,10,0.08)';
  ctx.fill();
}

// ── HELM WEATHER ──────────────────────────────────────────
let helmWx = null; // { wind: {...hourly}, marine: {...hourly} }
const HELM_WX_KEY = 'sbs-helm-wx';
const DIRS16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

async function fetchHelmWeather() {
  const pos = SBSData.position;
  const lat = pos?.latitude  ?? 47.6062;
  const lon = pos?.longitude ?? -122.3321;

  // Serve from cache if same position and <30 min old
  try {
    const cached = JSON.parse(localStorage.getItem(HELM_WX_KEY) || 'null');
    if (cached && Date.now() - cached.ts < 30*60*1000 &&
        Math.abs(cached.lat - Math.round(lat * 10)) <= 1) {
      helmWx = cached.data;
      buildForecastStrip();
      return;
    }
  } catch(_) {}

  try {
    const [windRes, marineRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
        + `&hourly=windspeed_10m,winddirection_10m,weathercode&forecast_days=2&wind_speed_unit=kn&timezone=UTC&forecast_hours=25`),
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
        + `&hourly=wave_height,ocean_current_velocity,ocean_current_direction&wind_speed_unit=kn&timezone=UTC&forecast_days=2`),
    ]);
    const wind   = windRes.ok   ? await windRes.json()   : null;
    const marine = marineRes.ok ? await marineRes.json() : null;
    helmWx = { wind, marine };
    localStorage.setItem(HELM_WX_KEY, JSON.stringify({ ts: Date.now(), lat: Math.round(lat * 10), data: helmWx }));
  } catch(e) { console.warn('helm weather fetch failed', e); }
  buildForecastStrip();
}

function buildForecastStrip() {
  const strip = document.getElementById('wx-strip');
  if (!strip) return;

  // Build a set of route-aware time slots if passage is planned
  const p = SBSData.passage;
  const slots = [];
  const now = Date.now();

  // Time slots: current + next 7 hours
  for (let i = 0; i < 8; i++) {
    const slotMs  = now + i * 3600000;
    const slotDt  = new Date(slotMs);
    const isoHour = slotDt.toISOString().slice(0, 13); // "2025-03-27T14"

    let windKt = null, windDir = null, currentKt = null, currentDir = null, waveM = null;

    if (helmWx?.wind?.hourly) {
      const h = helmWx.wind.hourly;
      const idx = h.time?.findIndex(t => t.startsWith(isoHour));
      if (idx >= 0) {
        windKt  = Math.round(h.windspeed_10m[idx]);
        windDir = DIRS16[Math.round(h.winddirection_10m[idx] / 22.5) % 16];
      }
    }
    if (helmWx?.marine?.hourly) {
      const m = helmWx.marine.hourly;
      const idx = m.time?.findIndex(t => t.startsWith(isoHour));
      if (idx >= 0) {
        currentKt  = m.ocean_current_velocity[idx]?.toFixed(1) ?? null;
        currentDir = m.ocean_current_direction[idx] != null
          ? DIRS16[Math.round(m.ocean_current_direction[idx] / 22.5) % 16] : null;
        waveM = m.wave_height[idx]?.toFixed(1) ?? null;
      }
    }

    // Label: time or upcoming waypoint name
    let label = slotDt.toUTCString().slice(17, 22) + 'z';
    if (i === 0) label = 'NOW';

    // Check if a waypoint falls in this 1-hour window
    if (p.active && p.waypoints.length && p.planETA && p.planSOG) {
      const wp = p.waypoints[p.nextWPIndex];
      if (wp?.distance != null && p.planSOG > 0) {
        const etaMs = now + (wp.distance / p.planSOG) * 3600000;
        if (etaMs >= slotMs && etaMs < slotMs + 3600000) {
          label = wp.name || `WP${p.nextWPIndex + 1}`;
        }
      }
    }

    const windStr    = windKt != null ? `${windKt}kt ${windDir ?? ''}` : '--';
    const currentStr = currentKt != null ? `${currentKt}kt ${currentDir ?? ''}` : null;
    const waveStr    = waveM != null ? `${waveM}m` : null;

    let extras = '';
    if (currentStr) extras += `<span class="wsc-current">${currentStr}</span>`;
    if (waveStr)    extras += `<span class="wsc-wave">${waveStr}</span>`;

    slots.push(`<div class="wx-strip-cell${i === 0 ? ' wsc-now' : ''}">
      <span class="wsc-time">${label}</span>
      <span class="wsc-wind">${windStr}</span>
      ${extras}
    </div>`);
  }
  strip.innerHTML = slots.join('');
}

// ── PASSAGE TAB ───────────────────────────────────────────
function updatePassageTab() {
  const p   = SBSData.passage;
  const hasP = p.active && p.waypoints.length > 0;
  const wp  = p.waypoints[p.nextWPIndex];

  const nwNo = document.getElementById('nw-no-passage');
  const nwc  = document.getElementById('nw-content');
  if (nwNo) nwNo.style.display = hasP ? 'none' : '';
  if (nwc)  nwc.style.display = hasP ? 'flex' : 'none';

  if (hasP && wp) {
    setText('nw-name',  wp.name || `WP ${p.nextWPIndex + 1}`);
    setText('nw-brg',   wp.bearing   != null ? SBSData.fmtBearing(wp.bearing)   : '---');
    setText('nw-dist',  wp.distance  != null ? SBSData.fmt(wp.distance, 1)       : '---');

    const vmg = calcVMG(wp.bearing);
    setText('nw-vmg', SBSData.fmt(vmg, 1));

    const eta = wp.distance != null && vmg > 0.1
      ? new Date(Date.now() + (wp.distance / vmg) * 3600000) : null;
    setText('nw-eta', eta ? eta.toUTCString().slice(17,22) : '---');

    const total = p.waypoints.length;
    const pct   = Math.round((p.nextWPIndex / Math.max(total - 1, 1)) * 100);
    const progFill = document.getElementById('prog-fill');
    if (progFill) progFill.style.width = pct + '%';
    setText('prog-pct',  pct + '%');
    setText('prog-from', p.waypoints[0]?.name?.split(' ')[0] || '—');
    setText('prog-to',   p.waypoints[total-1]?.name?.split(' ')[0] || '—');

    setText('perf-sog',  SBSData.fmt(SBSData.sog, 1));
    setText('perf-plan', SBSData.fmt(p.planSOG, 1));

    const perfEl = document.getElementById('perf-delta');
    if (perfEl && SBSData.sog != null && p.planSOG) {
      const diff = SBSData.sog - p.planSOG;
      perfEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1) + ' kn vs plan';
      perfEl.style.color = diff >= -0.5 ? 'var(--c-green)' : 'var(--c-red)';
    }

    const remDist = remainingDistance();
    const revETA = SBSData.sog > 0.3 && remDist > 0
      ? new Date(Date.now() + (remDist / SBSData.sog) * 3600000) : null;
    setText('perf-eta', revETA
      ? revETA.toUTCString().slice(5,11) + ' ' + revETA.toUTCString().slice(17,22) : '---');
  }

  renderHelmWPList();
  renderHelmAlerts();
  updateAPCard();
}

function calcVMG(bearing) {
  if (SBSData.sog == null || bearing == null || SBSData.cog == null) return 0;
  const angle = (bearing - SBSData.cog) * Math.PI / 180;
  return Math.max(0, SBSData.sog * Math.cos(angle));
}

function remainingDistance() {
  const p = SBSData.passage;
  if (!p.waypoints.length) return 0;
  let d = 0;
  for (let i = p.nextWPIndex + 1; i < p.waypoints.length; i++) {
    const a = p.waypoints[i-1], b = p.waypoints[i];
    if (a.lat && b.lat) d += haversine(a.lat, a.lon, b.lat, b.lon);
  }
  return d;
}

function haversine(la1, lo1, la2, lo2) {
  const R = 3440.065, dLa=(la2-la1)*Math.PI/180, dLo=(lo2-lo1)*Math.PI/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderHelmWPList() {
  const p   = SBSData.passage;
  const el  = document.getElementById('helm-wp-list');
  if (!el) return;
  if (!p.active || !p.waypoints.length) {
    el.innerHTML = `<div style="color:var(--t-muted);font-family:var(--font-display);
      font-size:var(--s-xs);letter-spacing:0.06em;padding:var(--sp-sm)">No waypoints</div>`;
    return;
  }
  el.innerHTML = p.waypoints.map((wp, i) => {
    const cls = i < p.nextWPIndex ? 'wp-done' : i === p.nextWPIndex ? 'wp-next' : '';
    return `<div class="wp-row ${cls}">
      <span class="wp-idx">${i+1}</span>
      <span class="wp-n">${wp.name || 'WP '+(i+1)}</span>
      ${wp.distance != null ? `<span class="wp-d">${wp.distance.toFixed(1)}nm</span>` : ''}
    </div>`;
  }).join('');
}

function renderHelmAlerts() {
  const alerts = SBSData.passage.alerts;
  const el     = document.getElementById('helm-alerts');
  const replan = document.getElementById('replan-btn');

  const tab = document.getElementById('htab-passage');
  let badge = tab ? tab.querySelector('.badge') : null;
  const totalCount  = alerts.length;
  if (totalCount > 0 && tab) {
    if (!badge) { badge = document.createElement('span'); badge.className='badge'; tab.appendChild(badge); }
    badge.textContent = totalCount;
  } else if (badge) badge.remove();

  if (!el) return;
  if (!alerts.length) {
    el.innerHTML = `<div style="color:var(--c-green);font-family:var(--font-display);
      font-size:var(--s-xs);letter-spacing:0.06em;padding:var(--sp-sm)">All clear</div>`;
    if (replan) replan.style.display = 'none';
    return;
  }

  el.innerHTML = alerts.map(a => `
    <div class="alert-row ${a.level}">
      <span>${a.message}</span>
      <button class="ar-dismiss" onclick="SBSData.dismissAlert('${a.id}')">✕</button>
    </div>`).join('');

  if (replan) replan.style.display = alerts.length > 0 ? '' : 'none';
}

function helmAdvanceWP() {
  SBSData.advanceWaypoint();
  updatePassageTab();
}

// ── AUTOPILOT → TP22 ──────────────────────────────────────
const RELAY_URL = '/api';
let apPassageActive = false;  // true = TP22 steering to a SignalK destination

function updateAPCard() {
  const p   = SBSData.passage;
  const wp  = p.active && p.waypoints.length ? p.waypoints[p.nextWPIndex] : null;
  const engBtn  = document.getElementById('ap-engage-wp-btn');
  const disBtn  = document.getElementById('ap-disengage-btn');
  const info    = document.getElementById('ap-dest-info');
  const sts     = document.getElementById('ap-passage-status');

  if (apPassageActive) {
    if (engBtn) { engBtn.style.display = 'none'; }
    if (disBtn) { disBtn.style.display = ''; }
    if (wp && info) info.textContent = `Steering → ${wp.name || 'WP '+(p.nextWPIndex+1)}`;
    if (sts)  { sts.textContent = 'ENGAGED'; sts.style.color = 'var(--c-green)'; }
  } else {
    if (engBtn) {
      engBtn.style.display = '';
      engBtn.disabled = !wp;
      engBtn.textContent = wp ? `ENGAGE → ${wp.name || 'WP '+(p.nextWPIndex+1)}` : 'ENGAGE →WP';
    }
    if (disBtn) { disBtn.style.display = 'none'; }
    if (info) info.textContent = wp ? `Next: ${wp.name || 'WP '+(p.nextWPIndex+1)}`
                                    : 'No active passage';
    if (sts)  { sts.textContent = 'STANDBY'; sts.style.color = ''; }
  }
}

async function helmAPEngage() {
  const p  = SBSData.passage;
  const wp = p.active && p.waypoints.length ? p.waypoints[p.nextWPIndex] : null;
  if (!wp) return;
  const sts = document.getElementById('ap-passage-status');
  if (sts) { sts.textContent = 'ENGAGING…'; sts.style.color = 'var(--c-amber)'; }
  try {
    const r = await fetch(`${RELAY_URL}/autopilot/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: wp.lat, lon: wp.lon, name: wp.name || `WP ${p.nextWPIndex+1}` }),
    });
    const data = await r.json();
    if (r.ok && data.active) {
      apPassageActive = true;
    } else {
      if (sts) { sts.textContent = data.error || 'Error'; sts.style.color = 'var(--c-red)'; }
    }
  } catch(e) {
    if (sts) { sts.textContent = 'Relay unreachable'; sts.style.color = 'var(--c-red)'; }
  }
  updateAPCard();
}

async function helmAPDisengage() {
  const sts = document.getElementById('ap-passage-status');
  if (sts) { sts.textContent = 'DISENGAGING…'; sts.style.color = 'var(--c-amber)'; }
  try {
    await fetch(`${RELAY_URL}/autopilot/deactivate`, { method: 'POST' });
  } catch(_) {}
  apPassageActive = false;
  updateAPCard();
}

// Poll SignalK destination status every 15 s to stay in sync
(async function apStatusPoll() {
  try {
    const r = await fetch(`${RELAY_URL}/autopilot/status`);
    if (r.ok) {
      const d = await r.json();
      apPassageActive = !!d.active;
      updateAPCard();
    }
  } catch(_) {}
  setTimeout(apStatusPoll, 15000);
})();

// ── MOB ───────────────────────────────────────────────────
let mobActive   = false;
let mobStart    = null;
let mobInterval = null;
let mobPosition = null;

function mobActivate() {
  if (mobActive) return;
  mobActive   = true;
  mobStart    = Date.now();
  mobPosition = SBSData.position;

  const overlay = document.getElementById('mob-overlay');
  if (overlay) overlay.classList.add('active');

  const coordEl = document.getElementById('mob-coord');
  if (coordEl && mobPosition) {
    coordEl.innerHTML = `Position at activation:<br>${SBSData.fmtCoord(mobPosition.latitude, mobPosition.longitude)}`;
  }

  document.querySelectorAll('#mob-checklist li').forEach(li => li.classList.remove('checked'));

  mobInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - mobStart) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2,'0');
    const s = (elapsed % 60).toString().padStart(2,'0');
    const timer = document.getElementById('mob-timer');
    if (timer) timer.textContent = `${m}:${s}`;
  }, 1000);

  if (typeof SBSData.raiseUrgent === 'function') {
    SBSData.raiseUrgent('mob', '⚠ MAN OVERBOARD — recovery in progress');
  }
}

function mobClear() {
  clearMOB();
  alert('MOB RECOVERED — log the incident in the passage log.');
}

function mobFalse() {
  if (confirm('Confirm false alarm?')) clearMOB();
}

function mobMayday() {
  alert('MAYDAY PROCEDURE:\n\nVHF Ch16: "MAYDAY MAYDAY MAYDAY"\nVessel name × 3\nPosition: ' +
    (mobPosition ? SBSData.fmtCoord(mobPosition.latitude, mobPosition.longitude) : 'see chartplotter') +
    '\nNature: Man Overboard\nPersons: state number\n"OVER"');
}

function clearMOB() {
  mobActive = false;
  clearInterval(mobInterval);
  const overlay = document.getElementById('mob-overlay');
  if (overlay) overlay.classList.remove('active');
  SBSData.dismissAlert('mob');
}

// ── STARTUP ───────────────────────────────────────────────
// Load passage from relay server (shared across all devices).
// Falls back to localStorage if relay is unreachable.
(async function loadPassageFromStorage() {
  let saved = null;

  // Fetch with manual timeout (AbortSignal.timeout not reliable on all Android WebViews)
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(`${RELAY_URL}/passage`, { signal: controller.signal });
    clearTimeout(tid);
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.waypoints) && d.waypoints.length) {
        saved = d;
        // Cache on this device so future loads are instant
        try { localStorage.setItem('sbs-passage', JSON.stringify(d)); } catch(_) {}
      }
    }
  } catch(_) {}

  // Fall back to localStorage (works offline / relay unreachable)
  if (!saved) {
    try {
      const raw = localStorage.getItem('sbs-passage');
      if (raw) saved = JSON.parse(raw);
    } catch(_) {}
  }

  if (saved && Array.isArray(saved.waypoints) && saved.waypoints.length) {
    SBSData.setPassage({
      waypoints: saved.waypoints,
      planSOG:   saved.planSOG || 5,
      planETA:   saved.departureTime || null,
    });
    updatePassageTab();
  }
})();

updatePassageTab();
fetchHelmWeather();

// Bottom nav
if (typeof SBSNav !== 'undefined') SBSNav.init();
