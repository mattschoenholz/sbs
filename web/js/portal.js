/* Portal-specific logic — runs after sbs-data.js and sbs-components.js */

let wxData = null; // declared here to avoid TDZ error when buildPassageAlerts runs at init

const CHANNELS = [
  { ch:1, name:'Cabin Lights',  icon:'💡' },
  { ch:2, name:'Nav Lights',    icon:'🔦' },
  { ch:3, name:'Anchor Light',  icon:'⚓' },
  { ch:4, name:'Bilge Pump',    icon:'💧' },
  { ch:5, name:'Water Pump',    icon:'🚿' },
  { ch:6, name:'Vent Fan',      icon:'🌀' },
  { ch:7, name:'Instruments',   icon:'🧭' },
  { ch:8, name:'Starlink',      icon:'🛰️' },
];

const RELAY_BASE = `http://${window.location.hostname}:5000`;

// ── TABS ──────────────────────────────────────────────────
document.querySelectorAll('.sbs-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab;
    document.querySelectorAll('.sbs-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sbs-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-panel="${id}"]`).classList.add('active');
    onTabShow(id);
  });
});

function onTabShow(id) {
  if (id === 'charts') {
    if (typeof SBSChart !== 'undefined') { SBSChart.init(); SBSChart.update(); }
  } else if (id === 'instruments') {
    updateInstTiles(); updateSkDiag();
  } else if (id === 'weather') {
    fetchWeather();
  } else if (id === 'plan') {
    renderPassage(); fetchWeather(); fetchTides();
    setTimeout(() => { initPlanMap(); planMap?.invalidateSize(); }, 120);
  } else if (id === 'controls') {
    pollTemps(); checkHotspot();
  }
}

// ── TOAST ─────────────────────────────────────────────────
let _tt;
function toast(msg, ms=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('show'), ms);
}

// ── RELAYS ────────────────────────────────────────────────
function buildRelays() {
  const grid = document.getElementById('relay-grid');
  CHANNELS.forEach(r => {
    const el = document.createElement('relay-button');
    el.setAttribute('channel', r.ch);
    el.setAttribute('name', r.name);
    el.setAttribute('icon', r.icon);
    grid.appendChild(el);
  });
}

async function allRelaysOff() {
  for (const ch of CHANNELS) await SBSData.toggleRelay(ch.ch, false);
  toast('All relays off');
}

// ── HOTSPOT ───────────────────────────────────────────────
let hotspotOn = false;
// ── TEMPERATURES ─────────────────────────────────────────────
const TEMP_THRESHOLDS = { cabin: 113, engine: 176, exhaust: 194, water: 140 }; // °F

async function pollTemps() {
  try {
    const res  = await fetch(`${RELAY_BASE}/temperatures`);
    const data = await res.json();
    for (const [name, obj] of Object.entries(data)) {
      const cEl  = document.getElementById(`c-${name}`);
      const card = document.getElementById(`tc-${name}`);
      if (!cEl) continue;
      const c = obj?.fahrenheit;
      if (c != null && !isNaN(c)) {
        cEl.textContent = c.toFixed(1) + '°';
        const thresh = TEMP_THRESHOLDS[name];
        if (card) card.classList.toggle('hot', thresh != null && c >= thresh);
      } else {
        cEl.textContent = '--.-°';
        if (card) card.classList.remove('hot');
      }
    }
  } catch (e) {
    // silently fail — sensors may be unavailable
  }
}

// ── HOTSPOT ─────────────────────────────────────────────────
async function checkHotspot() {
  try {
    const res = await fetch(`${RELAY_BASE}/hotspot/status`);
    const d = await res.json();
    hotspotOn = d.active === true;
    document.getElementById('hotspot-state').textContent = hotspotOn ? 'ON' : 'OFF';
    document.getElementById('hotspot-btn').style.borderColor = hotspotOn ? 'var(--c-green)' : '';
  } catch(e) {}
}
async function toggleHotspot() {
  try {
    await fetch(`${RELAY_BASE}/hotspot/${hotspotOn ? 'off' : 'on'}`, {method:'POST'});
    hotspotOn = !hotspotOn;
    document.getElementById('hotspot-state').textContent = hotspotOn ? 'ON' : 'OFF';
    document.getElementById('hotspot-btn').style.borderColor = hotspotOn ? 'var(--c-green)' : '';
    toast(`Hotspot ${hotspotOn ? 'enabled' : 'disabled'}`);
  } catch(e) { toast('Hotspot toggle failed'); }
}


// ── SYSTEM ────────────────────────────────────────────────
async function confirmAction(action) {
  if (!confirm(`${action === 'reboot' ? 'Reboot' : 'Shutdown'} sailboatserver?`)) return;
  try {
    await fetch(`${RELAY_BASE}/system/${action}`, {method:'POST'});
    toast(`${action} initiated…`, 5000);
  } catch(e) { toast(`${action} failed`); }
}

// ════════════════════════════════════════════════════════
// PASSAGE PLANNING
// ════════════════════════════════════════════════════════
let passage = {
  from:'', to:'', waypoints:[], planSOG:5.0,
  departureTime:null, selectedWindow:0,
  crew:['Skipper','Crew 1','Crew 2']
};

function savePassage() { localStorage.setItem('sbs-passage', JSON.stringify(passage)); }
function loadPassage() {
  try { const s = localStorage.getItem('sbs-passage'); if (s) passage = {...passage,...JSON.parse(s)}; } catch(e){}
}

function newPassage() {
  const from = prompt('Departure port:'); if (!from) return;
  const to   = prompt('Destination:');   if (!to)   return;
  const sog  = parseFloat(prompt('Planned SOG (knots):', '5.0') || '5.0');
  passage = {from, to, waypoints:[], planSOG:sog,
    departureTime:Date.now(), selectedWindow:0, crew:passage.crew};
  savePassage(); renderPassage(); toast(`${from} → ${to}`);
}

function clearPassage() {
  if (!confirm('Clear passage?')) return;
  passage = {...passage, from:'', to:'', waypoints:[]};
  localStorage.removeItem('sbs-passage');
  renderPassage(); SBSData.clearPassage();
}

function renderPassage() {
  const active = !!(passage.from && passage.to);
  document.getElementById('route-title').textContent =
    active ? `${passage.from} → ${passage.to}` : 'No passage planned';
  document.getElementById('clear-btn').style.display = active ? '' : 'none';

  const dist  = calcTotalDist();
  const hours = passage.planSOG > 0 ? dist / passage.planSOG : null;
  const eta   = hours && passage.departureTime
    ? new Date(passage.departureTime + hours * 3600000) : null;

  document.getElementById('kpi-dist').textContent = dist > 0 ? dist.toFixed(1) : '---';
  document.getElementById('kpi-time').textContent = hours ? hours.toFixed(1) : '---';
  document.getElementById('kpi-sog').textContent  = passage.planSOG ? passage.planSOG.toFixed(1) : '---';
  document.getElementById('kpi-eta').textContent  = eta
    ? eta.toUTCString().slice(5,11)+' '+eta.toUTCString().slice(17,22) : '---';

  renderWaypoints();
  buildDepartureWindows();
  buildSafetyBars();
  buildWatchSchedule();
  renderManagePassage();
  updatePlanMap();

  if (active) SBSData.setPassage({waypoints:passage.waypoints,
    planSOG:passage.planSOG, planETA:eta ? eta.getTime() : null});
}

function toggleWPForm() {
  const f = document.getElementById('add-wp-form');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

function addWaypoint() {
  const name  = document.getElementById('wp-name').value.trim();
  const coord = document.getElementById('wp-coord').value.trim();
  if (!name || !coord) { toast('Enter name and coordinates'); return; }
  const parts = coord.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]))
    { toast('Use: 48.384, -124.721'); return; }
  passage.waypoints.push({name, lat:parts[0], lon:parts[1]});
  document.getElementById('wp-name').value = '';
  document.getElementById('wp-coord').value = '';
  document.getElementById('add-wp-form').style.display = 'none';
  savePassage(); renderPassage();
}

function removeWaypoint(i) {
  passage.waypoints.splice(i, 1); savePassage(); renderPassage(); updatePlanMap();
}

// ── PLAN MAP ─────────────────────────────────────────────────
let planMap = null, planRouteLine = null, planMarkers = [];

const PLAN_WMS_BASE = `http://${window.location.hostname}/cgi-bin/mapserv`;
const HAZARD_LAYERS = ['WRECKS', 'UWTROC', 'OBSTRN'];
const HAZARD_BUF = 0.002; // ~200m buffer

async function checkWaypointHazard(lat, lon) {
  const b = HAZARD_BUF;
  const bbox = `${lon-b},${lat-b},${lon+b},${lat+b}`;
  const layers = HAZARD_LAYERS.join(',');
  const url = `${PLAN_WMS_BASE}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=${layers}&QUERY_LAYERS=${layers}&STYLES=` +
    `&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50` +
    `&INFO_FORMAT=text%2Fplain&FEATURE_COUNT=1`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const text = await resp.text();
    // MapServer plain text: lines like "Layer 'WRECKS'" appear when features found
    return /Layer '(WRECKS|UWTROC|OBSTRN)'/i.test(text);
  } catch { return false; }
}

async function checkAllHazards() {
  const wps = passage.waypoints;
  if (!wps.length) return;
  await Promise.all(wps.map((wp, i) =>
    checkWaypointHazard(wp.lat, wp.lon).then(h => { wps[i].hazard = h; })
  ));
  updatePlanMap();
}

function initPlanMap() {
  if (planMap || typeof L === 'undefined') return;
  const pos = SBSData.position;
  const center = pos ? [pos.latitude, pos.longitude] : [47.6062, -122.3321];
  planMap = L.map('plan-map', { zoomControl: true, attributionControl: false }).setView(center, 9);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 13
  }).addTo(planMap);

  // Tap to add waypoint
  planMap.on('click', e => {
    const n = passage.waypoints.length + 1;
    passage.waypoints.push({ name: `WP${n}`, lat: e.latlng.lat, lon: e.latlng.lng });
    savePassage(); renderPassage(); updatePlanMap();
    checkAllHazards();
  });

  // Popup remove button
  planMap.on('popupopen', e => {
    const btn = e.popup.getElement()?.querySelector('[data-wp-remove]');
    if (btn) btn.addEventListener('click', () => {
      removeWaypoint(parseInt(btn.dataset.wpRemove));
      planMap.closePopup();
    });
  });

  updatePlanMap();
  checkAllHazards();
}

function updatePlanMap() {
  if (!planMap) return;

  // Clear existing overlays
  planMarkers.forEach(m => planMap.removeLayer(m));
  planMarkers = [];
  if (planRouteLine) { planMap.removeLayer(planRouteLine); planRouteLine = null; }

  const wps = passage.waypoints;
  if (!wps.length) return;

  // Route line
  const latlngs = wps.map(wp => [wp.lat, wp.lon]);
  planRouteLine = L.polyline(latlngs, { color: '#e8940a', weight: 2.5, opacity: 0.85 }).addTo(planMap);

  // Waypoint markers
  wps.forEach((wp, i) => {
    const isFirst = i === 0, isLast = i === wps.length - 1;
    // Red if hazard, otherwise positional color
    const color = wp.hazard ? '#ef4444'
      : isFirst ? '#22c55e' : isLast ? '#e8940a' : '#60a8d0';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};border:2px solid #080c10;box-shadow:0 0 6px ${color}88"></div>`,
      iconSize: [13, 13], iconAnchor: [6, 6]
    });
    const hazardNote = wp.hazard ? `<div style="font-size:10px;color:#ef4444;font-weight:700;margin-bottom:6px;letter-spacing:0.06em">⚠ HAZARD NEARBY</div>` : '';
    const m = L.marker([wp.lat, wp.lon], { draggable: true, icon }).addTo(planMap);
    m.bindPopup(
      `<div style="font-family:'Barlow Condensed',sans-serif;min-width:120px">
        <div style="font-size:13px;font-weight:700;color:#e8940a;letter-spacing:0.06em;margin-bottom:6px">${wp.name}</div>
        ${hazardNote}<div style="font-size:10px;color:#8fa3b3;font-family:'Share Tech Mono',monospace;margin-bottom:8px">${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}</div>
        <button data-wp-remove="${i}" style="background:#1e2e3a;border:1px solid #ef4444;color:#ef4444;border-radius:4px;padding:3px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;cursor:pointer">REMOVE</button>
      </div>`,
      { className: 'plan-wp-popup' }
    );
    m.on('dragend', () => {
      const ll = m.getLatLng();
      passage.waypoints[i].lat = ll.lat;
      passage.waypoints[i].lon = ll.lng;
      savePassage(); renderPassage(); updatePlanMap();
      checkAllHazards();
    });
    planMarkers.push(m);
  });

  // Only auto-fit on first route draw (2 waypoints); preserve zoom after that
  if (wps.length === 2) {
    planMap.fitBounds(planRouteLine.getBounds(), { padding: [24, 24], maxZoom: 12 });
  }
}

function renderWaypoints() {
  const tbody = document.getElementById('wp-tbody');
  if (!passage.waypoints.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--t-muted);text-align:center;
      padding:var(--sp-xl)">No waypoints</td></tr>`; return;
  }
  let cumHours = 0;
  tbody.innerHTML = passage.waypoints.map((wp, i) => {
    const d = segDist(i);
    cumHours += d / (passage.planSOG || 5);
    const eta = passage.departureTime
      ? new Date(passage.departureTime + cumHours*3600000) : null;
    return `<tr>
      <td class="wp-num">${i+1}</td>
      <td style="font-weight:500">${wp.name}</td>
      <td style="font-family:var(--font-mono);font-size:var(--s-xs)">${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}</td>
      <td style="font-family:var(--font-mono)">${d.toFixed(1)}</td>
      <td style="font-family:var(--font-mono);font-size:var(--s-xs)">
        ${eta ? eta.toUTCString().slice(5,11)+' '+eta.toUTCString().slice(17,22) : '---'}</td>
      <td><button class="sbs-btn" style="padding:2px 8px;font-size:10px"
        onclick="removeWaypoint(${i})">✕</button></td></tr>`;
  }).join('');
}

function segDist(i) {
  if (i === 0) return 0;
  return haversine(passage.waypoints[i-1].lat, passage.waypoints[i-1].lon,
                   passage.waypoints[i].lat,   passage.waypoints[i].lon);
}
function calcTotalDist() {
  if (passage.waypoints.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < passage.waypoints.length; i++) d += segDist(i);
  return d;
}
function haversine(la1, lo1, la2, lo2) {
  const R = 3440.065, dLa = (la2-la1)*Math.PI/180, dLo = (lo2-lo1)*Math.PI/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function buildDepartureWindows() {
  const c = document.getElementById('dep-windows');
  if (!passage.from) { c.innerHTML=''; return; }
  const base = passage.departureTime || Date.now();
  const wins = [
    {offset:0,  score:82, wind:'12-15kn SW', swell:'1.2m', cls:'good'},
    {offset:6,  score:67, wind:'15-20kn W',  swell:'1.5m', cls:'ok'},
    {offset:12, score:45, wind:'20-25kn NW', swell:'2.1m', cls:'marginal'},
    {offset:18, score:71, wind:'12-18kn SW', swell:'1.3m', cls:'ok'},
  ];
  c.innerHTML = wins.map((w,i) => {
    const t = new Date(base + w.offset*3600000);
    const ts = t.toUTCString().slice(5,11)+' '+t.toUTCString().slice(17,22)+'z';
    return `<div class="dep-window${passage.selectedWindow===i?' selected':''}" onclick="selectWin(${i})">
      <div class="dw-time">${ts}</div>
      <div class="dw-score ${w.cls}">${w.score}</div>
      <div class="dw-wind">${w.wind}</div>
      <div class="dw-wind" style="color:var(--c-blue-dim)">${w.swell}</div>
    </div>`;
  }).join('');
}
function selectWin(i) { passage.selectedWindow=i; savePassage(); buildDepartureWindows(); }

function buildSafetyBars() {
  const vc = {good:'var(--c-green)',ok:'var(--c-amber)',marginal:'var(--c-yellow)',bad:'var(--c-red)'};
  const bars = [
    {label:'Wind',       pct:75, cls:'ok',      verdict:'MODERATE'},
    {label:'Swell',      pct:60, cls:'ok',      verdict:'MODERATE'},
    {label:'Visibility', pct:90, cls:'good',    verdict:'GOOD'},
    {label:'Tidal Gate', pct:85, cls:'good',    verdict:'GOOD'},
    {label:'Fuel Range', pct:80, cls:'ok',      verdict:'ADEQUATE'},
  ];
  const html = bars.map(b=>`
    <div class="safety-row">
      <span class="s-label">${b.label}</span>
      <div class="safety-bar"><div class="safety-fill ${b.cls}" style="width:${b.pct}%"></div></div>
      <span class="s-verdict" style="color:${vc[b.cls]}">${b.verdict}</span>
    </div>`).join('');
  const sb = document.getElementById('safety-bars');
  const msb = document.getElementById('manage-safety-bars');
  if (sb) sb.innerHTML = html;
  if (msb) msb.innerHTML = html;
}

const WC = [
  {bg:'rgba(59,130,246,0.3)', border:'#3b82f6', text:'#93c5fd'},
  {bg:'rgba(34,197,94,0.3)',  border:'#22c55e', text:'#86efac'},
  {bg:'rgba(168,85,247,0.3)', border:'#a855f7', text:'#d8b4fe'},
];
function buildWatchSchedule() {
  const dist  = calcTotalDist();
  const hours = passage.planSOG > 0 ? dist / passage.planSOG : 24;
  const blocks = Math.ceil(hours / 3);
  const crew  = passage.crew || ['Skipper','Crew 1','Crew 2'];
  const start = passage.departureTime || Date.now();
  const grid  = document.getElementById('watch-grid');
  const sumEl = document.getElementById('watch-summary');

  if (!passage.from || dist === 0) {
    grid.innerHTML = `<div style="color:var(--t-muted);font-family:var(--font-display);
      font-size:var(--s-xs);letter-spacing:0.06em">No active passage</div>`;
    sumEl.textContent = ''; return;
  }

  const counts = crew.map(()=>0);
  let html = '';
  for (let i = 0; i < blocks; i++) {
    const ci = i % crew.length;
    counts[ci]++;
    const c = WC[ci % WC.length];
    const ts = new Date(start + i*3*3600000).toUTCString().slice(17,22);
    html += `<div class="watch-block" style="background:${c.bg};border:1px solid ${c.border};color:${c.text}">
      <span class="wb-time">${ts}z</span>
      <span class="wb-name">${crew[ci].split(' ')[0]}</span></div>`;
  }
  grid.innerHTML = html;
  sumEl.textContent = crew.map((c,i)=>`${c}: ${counts[i]*3}h`).join('  ·  ');
}


function renderManagePassage() {
  const routeEl = document.getElementById('manage-pass-route');
  const metaEl  = document.getElementById('manage-pass-meta');
  const statsEl = document.getElementById('manage-pass-stats');
  if (!routeEl) return;

  const active = !!(passage.from && passage.to);
  routeEl.textContent = active ? `${passage.from} → ${passage.to}` : 'No passage planned';
  metaEl.textContent  = active && passage.departureTime
    ? `DEPART ${new Date(passage.departureTime).toUTCString().slice(5,11)} UTC`
    : '';

  const dist  = calcTotalDist();
  const hours = passage.planSOG > 0 ? dist / passage.planSOG : null;
  const eta   = hours && passage.departureTime
    ? new Date(passage.departureTime + hours * 3600000) : null;

  if (statsEl) {
    if (active && dist > 0) {
      const days = hours >= 24 ? ` (${(hours/24).toFixed(1)}d)` : '';
      statsEl.innerHTML = `
        <div class="pst"><div class="pst-v">${dist.toFixed(1)}</div><div class="pst-l">nm total</div></div>
        <div class="pst"><div class="pst-v">${hours ? hours.toFixed(0) : '---'}${days}</div><div class="pst-l">hrs plan</div></div>
        <div class="pst"><div class="pst-v">${passage.planSOG ? passage.planSOG.toFixed(1) : '---'}</div><div class="pst-l">plan kn</div></div>
        <div class="pst"><div class="pst-v">${passage.waypoints.length}</div><div class="pst-l">waypoints</div></div>
        ${eta ? `<div class="pst"><div class="pst-v" style="font-size:var(--s-sm)">${eta.toUTCString().slice(5,11)}</div><div class="pst-l">ETA date</div></div>` : ''}`;
    } else statsEl.innerHTML = '';
  }

  // Draw all sub-sections
  drawPassageMap();
  renderPassageLive();
  buildPassageAlerts();
  renderPassageLegs();
}

// ── ROUTE MINI-MAP (SVG) ─────────────────────────────────────
function drawPassageMap() {
  const svg = document.getElementById('pass-route-svg');
  if (!svg) return;
  const wps = passage.waypoints;
  const VW = 400, VH = 220, PAD = 36;

  if (wps.length < 2) {
    svg.innerHTML = `<rect width="${VW}" height="${VH}" fill="#060e14"/>
      <text x="${VW/2}" y="${VH/2}" text-anchor="middle" dy="4"
        font-family="Barlow Condensed,sans-serif" font-size="13" fill="rgba(74,96,112,0.8)"
        letter-spacing="0.08em">ADD WAYPOINTS IN PLAN TAB</text>`;
    return;
  }

  const lats = wps.map(w => w.lat);
  const lons = wps.map(w => w.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const latRange = (maxLat - minLat) || 0.5;
  const lonRange = (maxLon - minLon) || 0.5;
  const latPad = latRange * 0.25, lonPad = lonRange * 0.25;

  const toSVG = (lat, lon) => ({
    x: PAD + ((lon - (minLon - lonPad)) / (lonRange + 2*lonPad)) * (VW - 2*PAD),
    y: (VH - PAD) - ((lat - (minLat - latPad)) / (latRange + 2*latPad)) * (VH - 2*PAD)
  });

  const nextIdx = SBSData.passage.nextWPIndex;
  let parts = [];

  parts.push(`<rect width="${VW}" height="${VH}" fill="#060e14"/>`);
  parts.push(`<g stroke="rgba(30,46,58,0.5)" stroke-width="0.5">`);
  for (let i = 1; i <= 4; i++) {
    const x = PAD + (i/5) * (VW-2*PAD);
    const y = PAD + (i/5) * (VH-2*PAD);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${PAD}" x2="${x.toFixed(1)}" y2="${VH-PAD}"/>`);
    parts.push(`<line x1="${PAD}" y1="${y.toFixed(1)}" x2="${VW-PAD}" y2="${y.toFixed(1)}"/>`);
  }
  parts.push('</g>');

  // Track line (done segment: green, remaining: amber dashed)
  if (nextIdx > 0) {
    const donePts = wps.slice(0, Math.min(nextIdx+1, wps.length))
      .map(w => { const p = toSVG(w.lat,w.lon); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
    parts.push(`<polyline points="${donePts}" fill="none" stroke="rgba(34,197,94,0.5)" stroke-width="2"/>`);
  }
  const remPts = wps.slice(Math.max(0, nextIdx))
    .map(w => { const p = toSVG(w.lat,w.lon); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  parts.push(`<polyline points="${remPts}" fill="none" stroke="rgba(232,148,10,0.5)" stroke-width="1.5" stroke-dasharray="6,4"/>`);

  // Leg midpoint labels (distance + duration)
  for (let i = 1; i < wps.length; i++) {
    const d   = haversine(wps[i-1].lat, wps[i-1].lon, wps[i].lat, wps[i].lon);
    const hrs = d / (passage.planSOG || 5);
    const dur = hrs >= 48 ? `${(hrs/24).toFixed(0)}d` : hrs >= 24 ? `${(hrs/24).toFixed(1)}d` : `${hrs.toFixed(0)}h`;
    const p1  = toSVG(wps[i-1].lat, wps[i-1].lon);
    const p2  = toSVG(wps[i].lat,   wps[i].lon);
    const mx  = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const done = i <= nextIdx;
    parts.push(`<text x="${mx.toFixed(1)}" y="${(my-6).toFixed(1)}" text-anchor="middle"
      font-family="Share Tech Mono,monospace" font-size="8"
      fill="${done ? 'rgba(34,197,94,0.6)' : 'rgba(232,148,10,0.6)'}">${d.toFixed(0)}nm·${dur}</text>`);
  }

  // Waypoint circles + labels
  wps.forEach((wp, i) => {
    const pt   = toSVG(wp.lat, wp.lon);
    const done = i < nextIdx, active = i === nextIdx;
    const first = i === 0, last = i === wps.length - 1;
    const r   = first || last ? 6 : 4;
    const fc  = done ? 'rgba(34,197,94,0.7)' : active ? '#f5a820' : first||last ? '#60a8d0' : 'rgba(74,96,112,0.9)';
    const sc  = done ? '#22c55e' : active ? '#e8940a' : '#2a3f50';
    const tc  = done ? '#22c55e' : active ? '#f5a820' : first||last ? '#60a8d0' : '#8fa3b3';
    const lbl = wp.name.length > 10 ? wp.name.slice(0,10)+'…' : wp.name;

    // Label: last waypoint goes left to avoid clipping
    const anchor = last && pt.x > VW*0.6 ? 'end' : first && pt.x < VW*0.4 ? 'start' : 'middle';
    const lx = anchor === 'end' ? pt.x - 7 : anchor === 'start' ? pt.x + 7 : pt.x;
    const ly = first ? pt.y + 15 : pt.y - 8;

    parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${r}" fill="${fc}" stroke="${sc}" stroke-width="1.5"/>`);
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}"
      font-family="Barlow Condensed,sans-serif" font-size="10" font-weight="700"
      fill="${tc}" letter-spacing="0.06em">${lbl}</text>`);
  });

  // Boat position triangle
  const pos = SBSData.position;
  if (pos?.latitude != null) {
    const bp  = toSVG(pos.latitude, pos.longitude);
    if (bp.x > -20 && bp.x < VW+20 && bp.y > -20 && bp.y < VH+20) {
      const cog = (SBSData.cog ?? 0) * Math.PI / 180;
      const sz  = 9;
      const tip = { x: bp.x + Math.sin(cog)*sz, y: bp.y - Math.cos(cog)*sz };
      const b1  = { x: bp.x + Math.sin(cog+2.4)*sz*0.45, y: bp.y - Math.cos(cog+2.4)*sz*0.45 };
      const b2  = { x: bp.x + Math.sin(cog-2.4)*sz*0.45, y: bp.y - Math.cos(cog-2.4)*sz*0.45 };
      parts.push(`<polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${b1.x.toFixed(1)},${b1.y.toFixed(1)} ${b2.x.toFixed(1)},${b2.y.toFixed(1)}"
        fill="#f5a820" stroke="#060e14" stroke-width="1.5"/>`);
    }
  }

  svg.innerHTML = parts.join('');
}

// ── LIVE STATUS PANEL ────────────────────────────────────────
function renderPassageLive() {
  const el = document.getElementById('pass-live-panel');
  if (!el) return;

  const active = !!(passage.from && passage.to && passage.waypoints.length > 1);
  if (!active) {
    el.innerHTML = `<div class="pass-no-data">No active passage — create one in the Plan tab</div>`;
    return;
  }

  const wps     = passage.waypoints;
  const p       = SBSData.passage;
  const nextIdx = p.nextWPIndex;
  const nextWP  = wps[nextIdx];
  const totalDist = calcTotalDist();
  const sog     = SBSData.sog;

  // Cumulative elapsed distance
  let elapsedDist = 0;
  if (nextIdx > 0) {
    for (let i = 1; i <= nextIdx && i < wps.length; i++)
      elapsedDist += haversine(wps[i-1].lat, wps[i-1].lon, wps[i].lat, wps[i].lon);
  }
  // Subtract remaining distance on active leg
  if (SBSData.position && nextWP && nextIdx > 0) {
    const legDist   = haversine(wps[nextIdx-1].lat, wps[nextIdx-1].lon, nextWP.lat, nextWP.lon);
    const distToNext = haversine(SBSData.position.latitude, SBSData.position.longitude, nextWP.lat, nextWP.lon);
    elapsedDist -= Math.max(0, distToNext - (legDist - distToNext));
  }
  elapsedDist = Math.max(0, Math.min(elapsedDist, totalDist));

  const remDist = totalDist - elapsedDist;
  const pct     = totalDist > 0 ? Math.min(100, (elapsedDist / totalDist) * 100) : 0;

  // Revised ETA from current SOG
  let revisedETA = null;
  if (sog != null && sog > 0.2 && remDist > 0)
    revisedETA = new Date(Date.now() + (remDist / sog) * 3600000);

  const planHrs = passage.planSOG > 0 ? totalDist / passage.planSOG : null;
  const planETA = planHrs && passage.departureTime
    ? new Date(passage.departureTime + planHrs * 3600000) : null;

  // Bearing + distance to next WP from current position
  let nextBrg = null, nextDist = null;
  if (SBSData.position && nextWP) {
    const pp = SBSData.position;
    nextDist = haversine(pp.latitude, pp.longitude, nextWP.lat, nextWP.lon);
    const dLon = (nextWP.lon - pp.longitude) * Math.PI / 180;
    const φ1 = pp.latitude * Math.PI / 180, φ2 = nextWP.lat * Math.PI / 180;
    nextBrg = Math.round((Math.atan2(
      Math.sin(dLon)*Math.cos(φ2),
      Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(dLon)
    ) * 180/Math.PI + 360) % 360);
  }

  const fmtETA = d => d ? d.toUTCString().slice(5,11) + ' ' + d.toUTCString().slice(17,22)+'z' : '---';
  const fmtTime = d => d ? d.toUTCString().slice(17,22)+'z' : '---';

  // SOG vs plan delta
  let sogDelta = '', sogClass = '';
  if (sog != null && passage.planSOG) {
    const delta = sog - passage.planSOG;
    sogDelta = (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'kn';
    sogClass = delta >= -0.5 ? 'color:var(--c-green)' : delta >= -1.5 ? 'color:var(--c-amber)' : 'color:var(--c-red)';
  }

  el.innerHTML = `
    <div class="pass-live-grid">
      <div class="pass-live-stat">
        <div class="pls-val">${elapsedDist.toFixed(1)}</div>
        <div class="pls-lbl">nm done</div>
      </div>
      <div class="pass-live-stat">
        <div class="pls-val">${remDist.toFixed(1)}</div>
        <div class="pls-lbl">nm rem</div>
      </div>
      <div class="pass-live-stat">
        <div class="pls-val">${sog != null ? sog.toFixed(1) : '---'}</div>
        <div class="pls-lbl">SOG kn</div>
      </div>
      <div class="pass-live-stat">
        <div class="pls-val" style="font-size:clamp(12px,2.2vw,18px)">${fmtTime(revisedETA)}</div>
        <div class="pls-lbl">Rev. ETA</div>
      </div>
    </div>

    <div class="pass-prog-wrap">
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);
        font-size:9px;color:var(--t-muted);margin-bottom:3px">
        <span>${passage.from || '—'}</span>
        <span>${pct.toFixed(0)}% complete</span>
        <span>${passage.to || '—'}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
    </div>

    ${nextWP ? `
    <div class="pass-next-wp">
      <div class="pass-next-label">Next Waypoint · ${nextIdx+1} of ${wps.length}</div>
      <div class="pass-next-name">${nextWP.name}</div>
      <div class="pass-next-grid">
        <div class="pass-live-stat">
          <div class="pls-val">${nextBrg != null ? nextBrg + '°' : '---'}</div>
          <div class="pls-lbl">Bearing</div>
        </div>
        <div class="pass-live-stat">
          <div class="pls-val">${nextDist != null ? nextDist.toFixed(1) : '---'}</div>
          <div class="pls-lbl">Dist nm</div>
        </div>
        <div class="pass-live-stat">
          <div class="pls-val" style="${sogClass}">${sogDelta || (sog != null ? sog.toFixed(1) : '---')}</div>
          <div class="pls-lbl">vs Plan</div>
        </div>
      </div>
    </div>` : `<div class="pass-no-data" style="color:var(--c-green)">✓ Destination reached</div>`}

    <div class="pass-eta-row">
      <span class="eta-item"><span class="eta-lbl">Plan ETA</span><span class="eta-val">${fmtETA(planETA)}</span></span>
      ${revisedETA ? `<span class="eta-item"><span class="eta-lbl">Revised</span><span class="eta-val revised">${fmtETA(revisedETA)}</span></span>` : ''}
    </div>`;
}

// ── WEATHER PASSAGE ALERTS ───────────────────────────────────
function buildPassageAlerts() {
  const el = document.getElementById('pass-alerts-list');
  if (!el) return;

  const alerts = [];

  // Live SignalK / passage data alerts
  const pa = SBSData.passage;
  if (pa?.alerts?.length) {
    pa.alerts.forEach(a => alerts.push({ level: a.level, msg: a.msg, src: 'NAV' }));
  }
  // Current wind
  if (SBSData.tws != null) {
    if (SBSData.tws >= 34) alerts.unshift({ level: 'urgent',   msg: `Current wind ${SBSData.tws.toFixed(0)}kn — GALE FORCE`, src: 'LIVE' });
    else if (SBSData.tws >= 25) alerts.unshift({ level: 'advisory', msg: `Current wind ${SBSData.tws.toFixed(0)}kn — strong breeze`, src: 'LIVE' });
  }

  // Forecast alerts at each waypoint ETA
  if (wxData?.hourly && passage.waypoints.length > 1 && passage.departureTime) {
    const times  = wxData.hourly.time;
    const speeds = wxData.hourly.windspeed_10m;
    const dirs   = wxData.hourly.winddirection_10m;
    const precip = wxData.hourly.precipitation_probability;
    const codes  = wxData.hourly.weathercode;
    const DIRS16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

    let cumHrs = 0;
    passage.waypoints.forEach((wp, i) => {
      if (i === 0) return;
      const d = haversine(passage.waypoints[i-1].lat, passage.waypoints[i-1].lon, wp.lat, wp.lon);
      cumHrs += d / (passage.planSOG || 5);

      const wpTime = new Date(passage.departureTime + cumHrs * 3600000);
      const iso    = wpTime.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
      const idx    = times.findIndex(t => t.startsWith(iso));
      if (idx < 0) return;

      const kt     = speeds[idx];
      const dir    = DIRS16[Math.round(dirs[idx] / 22.5) % 16];
      const pct    = precip[idx];
      const code   = codes[idx];
      const ts     = wpTime.toUTCString().slice(5,11) + ' ' + wpTime.toUTCString().slice(17,22)+'z';

      if (kt >= 34)
        alerts.push({ level:'urgent',   msg:`Gale ${Math.round(kt)}kn ${dir} near ${wp.name} (${ts})`, src:'FC' });
      else if (kt >= 25)
        alerts.push({ level:'advisory', msg:`Strong wind ${Math.round(kt)}kn ${dir} near ${wp.name} (${ts})`, src:'FC' });

      if ([95,96,99].includes(code))
        alerts.push({ level:'advisory', msg:`Thunderstorm forecast near ${wp.name} (${ts})`, src:'FC' });
      else if ([61,63,65,80,81,82].includes(code) && pct > 60)
        alerts.push({ level:'info',     msg:`Rain ${pct}% near ${wp.name} (${ts})`, src:'FC' });
    });
  }

  if (alerts.length === 0) {
    el.innerHTML = `<div class="pass-no-alerts">✓ No alerts — conditions look clear along the route</div>`;
    return;
  }

  const STYLES = {
    urgent:   { bg:'var(--c-red-dim)',    border:'var(--c-red)',    text:'var(--c-red)',    icon:'⚠' },
    advisory: { bg:'var(--c-yellow-dim)', border:'var(--c-yellow)', text:'var(--c-yellow)', icon:'⚡' },
    info:     { bg:'rgba(59,130,246,0.12)', border:'var(--c-blue)', text:'#93c5fd',         icon:'ℹ' },
  };
  el.innerHTML = alerts.map(a => {
    const s = STYLES[a.level] || STYLES.info;
    return `<div class="pass-alert-row" style="background:${s.bg};border-color:${s.border};color:${s.text}">
      <span class="par-icon">${s.icon}</span>
      <span class="par-msg">${a.msg}</span>
      <span class="par-src">${a.src}</span>
    </div>`;
  }).join('');
}

// ── LEG BREAKDOWN TIMELINE ───────────────────────────────────
function renderPassageLegs() {
  const el = document.getElementById('pass-legs');
  if (!el) return;

  const wps = passage.waypoints;
  if (wps.length < 2) {
    el.innerHTML = `<div class="pass-no-data">Add at least 2 waypoints in the Plan tab</div>`;
    return;
  }

  const nextIdx = SBSData.passage.nextWPIndex;
  const DIRS16  = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  let cumHrs = 0;

  el.innerHTML = wps.slice(1).map((wp, i) => {
    const legNum   = i + 1;
    const from     = wps[i];
    const d        = haversine(from.lat, from.lon, wp.lat, wp.lon);
    const hrs      = d / (passage.planSOG || 5);
    const deptHrs  = cumHrs;
    cumHrs        += hrs;

    const depDate  = passage.departureTime ? new Date(passage.departureTime + deptHrs*3600000) : null;
    const arrDate  = passage.departureTime ? new Date(passage.departureTime + cumHrs*3600000)  : null;
    const fmtT     = dt => dt ? dt.toUTCString().slice(17,22)+'z' : '---';
    const fmtDate  = dt => dt ? dt.toUTCString().slice(5,11) : '';

    // Bearing for this leg
    const dLon = (wp.lon - from.lon) * Math.PI / 180;
    const φ1   = from.lat * Math.PI / 180, φ2 = wp.lat * Math.PI / 180;
    const brg  = Math.round((Math.atan2(
      Math.sin(dLon)*Math.cos(φ2),
      Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(dLon)
    ) * 180/Math.PI + 360) % 360);

    // Duration label
    const durStr = hrs >= 48 ? `${Math.floor(hrs/24)}d ${Math.round(hrs%24)}h`
                 : hrs >= 24 ? `${(hrs/24).toFixed(1)}d`
                 : `${hrs.toFixed(1)}h`;

    // Weather at estimated arrival
    let wxHtml = '';
    if (wxData?.hourly && arrDate) {
      const times  = wxData.hourly.time;
      const speeds = wxData.hourly.windspeed_10m;
      const wdirs  = wxData.hourly.winddirection_10m;
      const codes  = wxData.hourly.weathercode;
      const precip = wxData.hourly.precipitation_probability;
      const iso    = arrDate.toISOString().slice(0, 13);
      const idx    = times.findIndex(t => t.startsWith(iso));
      if (idx >= 0) {
        const kt   = speeds[idx];
        const dir  = DIRS16[Math.round(wdirs[idx] / 22.5) % 16];
        const ico  = WX_CODES[codes[idx]] ?? '🌬';
        const pp   = precip[idx];
        const warnClass = kt >= 34 ? 'leg-wx-gale' : kt >= 25 ? 'leg-wx-warn' : '';
        wxHtml = `<div class="leg-stat ${warnClass}">
          <span class="ls-v">${ico} ${Math.round(kt)}kn ${dir}</span>
          <span class="ls-l">wx@arr${pp > 30 ? ' ' + pp + '%💧' : ''}</span>
        </div>`;
      }
    }

    const done   = legNum <= nextIdx;
    const active = legNum === nextIdx + 1;

    return `<div class="pass-leg${done ? ' leg-done' : ''}${active ? ' leg-active' : ''}">
      ${done   ? `<div class="leg-status done">✓ PASSED</div>` : ''}
      ${active ? `<div class="leg-status active">▶ ACTIVE</div>` : ''}
      <div class="leg-num">Leg ${legNum}</div>
      <div class="leg-route">
        <span class="leg-from">${from.name}</span>
        <span class="leg-arrow">→</span>
        <span class="leg-to">${wp.name}</span>
      </div>
      <div class="leg-stats">
        <div class="leg-stat">
          <span class="ls-v">${d.toFixed(1)}</span>
          <span class="ls-l">nm</span>
        </div>
        <div class="leg-stat">
          <span class="ls-v">${brg}°</span>
          <span class="ls-l">heading</span>
        </div>
        <div class="leg-stat">
          <span class="ls-v">${durStr}</span>
          <span class="ls-l">duration</span>
        </div>
        <div class="leg-stat">
          <span class="ls-v">${fmtDate(depDate)} ${fmtT(depDate)}</span>
          <span class="ls-l">depart</span>
        </div>
        <div class="leg-stat">
          <span class="ls-v">${fmtDate(arrDate)} ${fmtT(arrDate)}</span>
          <span class="ls-l">arrive</span>
        </div>
        ${wxHtml}
      </div>
    </div>`;
  }).join('');
}

SBSData.on('update', () => {
  const alerts = SBSData.passage.alerts.filter(a => a.level === 'advisory');
  const tab = document.getElementById('tab-plan');
  let badge = tab ? tab.querySelector('.badge') : null;
  if (alerts.length > 0 && tab) {
    if (!badge) { badge = document.createElement('span'); badge.className='badge'; tab.appendChild(badge); }
    badge.textContent = alerts.length;
  } else if (badge) badge.remove();
});

buildRelays();
loadPassage();
renderPassage();
checkHotspot();
pollTemps();
setInterval(pollTemps, 10000);

SBSData.on('connected', () => {
  const dot = document.getElementById('sk-conn-dot');
  if (dot) { dot.className = 'sk-dot sk-dot-on'; dot.title = 'Connected'; }
});
SBSData.on('disconnected', () => {
  const dot = document.getElementById('sk-conn-dot');
  if (dot) { dot.className = 'sk-dot sk-dot-off'; dot.title = 'Disconnected'; }
});

function updateInstTiles() {
  const d = SBSData;
  const set = (id, val, dec = 1) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? d.fmt(val, dec) : '---';
  };

  // Navigation
  set('it-sog', d.sog, 1);
  const cogEl = document.getElementById('it-cog');
  if (cogEl) cogEl.textContent = d.cog != null ? d.fmtBearing(d.cog) : '---';
  const hdgEl = document.getElementById('it-hdg');
  if (hdgEl) hdgEl.textContent = d.heading != null ? d.fmtBearing(d.heading) : '---';
  set('it-stw', d.stw, 1);

  // Depth with color-coded tile
  const depthEl   = document.getElementById('it-depth');
  const depthTile = document.getElementById('itile-depth');
  if (depthEl) depthEl.textContent = d.depth != null ? d.fmt(d.depth, 1) : '---';
  if (depthTile) {
    const shallow = 3, critical = 1;
    depthTile.classList.toggle('shallow',  d.depth != null && d.depth >= critical && d.depth < shallow);
    depthTile.classList.toggle('critical', d.depth != null && d.depth < critical);
  }

  // Wind
  set('it-tws', d.tws, 1);
  const twdEl = document.getElementById('it-twd');
  if (twdEl) twdEl.textContent = d.twd != null ? d.fmtBearing(d.twd) : '---';
  set('it-aws', d.aws, 1);
  const awaEl = document.getElementById('it-awa');
  if (awaEl) {
    if (d.awa != null) {
      let a = d.awa;
      if (a > 180) a -= 360;
      awaEl.textContent = (a >= 0 ? '+' : '') + Math.round(a) + '°';
    } else {
      awaEl.textContent = '---';
    }
  }

  // Environment
  set('it-baro', d.pressure, 0);
  set('it-temp', d.temp, 1);
  set('it-hum',  d.humidity, 0);

  // Bilge
  const bilgeEl   = document.getElementById('it-bilge');
  const bilgeTile = document.getElementById('itile-bilge');
  const wet = !!d.bilge;
  if (bilgeEl)   bilgeEl.textContent = wet ? 'WET' : 'DRY';
  if (bilgeTile) {
    bilgeTile.classList.toggle('bilge-wet', wet);
    bilgeTile.classList.toggle('green',    !wet);
  }
}

function updateSkDiag() {
  const d = SBSData;
  const pos = d.position;
  const setRow = (id, val, unit = '') => {
    const row = document.getElementById(id);
    if (!row) return;
    const vEl = row.querySelector('.sk-val');
    if (!vEl) return;
    const hasData = val != null;
    row.classList.toggle('sk-row-ok', hasData);
    vEl.textContent = hasData ? `${val}${unit ? ' ' + unit : ''}` : '—';
  };
  setRow('sk-d-sog',   d.sog   != null ? d.sog.toFixed(2) : null,   'kt');
  setRow('sk-d-cog',   d.cog   != null ? d.cog.toFixed(1) : null,   '°');
  setRow('sk-d-hdg',   d.heading != null ? d.heading.toFixed(1) : null, '°');
  setRow('sk-d-depth', d.depth != null ? d.depth.toFixed(2) : null, 'm');
  setRow('sk-d-tws',   d.tws   != null ? d.tws.toFixed(2)  : null,  'kt');
  setRow('sk-d-twd',   d.twd   != null ? d.twd.toFixed(1)  : null,  '°');
  setRow('sk-d-aws',   d.aws   != null ? d.aws.toFixed(2)  : null,  'kt');
  setRow('sk-d-pres',  d.pressure != null ? d.pressure.toFixed(1) : null, 'hPa');
  setRow('sk-d-temp',  d.temp  != null ? d.temp.toFixed(1)  : null, '°F');
  if (pos?.latitude != null) {
    const posRow = document.getElementById('sk-d-pos');
    const vEl = posRow?.querySelector('.sk-val');
    if (vEl) { vEl.textContent = `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`; }
    posRow?.classList.add('sk-row-ok');
  }
  const ctxEl = document.getElementById('sk-d-ctx-val');
  if (ctxEl) ctxEl.textContent = d._selfContext ?? '(not yet fetched)';
  const luEl = document.getElementById('sk-last-update');
  if (luEl && d._state.lastUpdate) {
    const s = Math.round((Date.now() - d._state.lastUpdate) / 1000);
    luEl.textContent = s < 5 ? 'just now' : `${s}s ago`;
  }
}

SBSData.on('update', () => {
  if (typeof SBSChart !== 'undefined' && document.querySelector('[data-panel="charts"]')?.classList.contains('active')) {
    SBSChart.update();
  }
  const pos = SBSData.position;
  const el  = document.getElementById('header-coords');
  if (el && pos && pos.latitude != null && pos.longitude != null)
    el.textContent = `${pos.latitude.toFixed(4)}°, ${pos.longitude.toFixed(4)}°`;
  if (document.querySelector('[data-panel="instruments"]')?.classList.contains('active')) {
    updateInstTiles();
    updateSkDiag();
  }
  if (document.querySelector('[data-panel="plan"]')?.classList.contains('active')) {
    renderPassageLive();
    drawPassageMap();
    buildPassageAlerts();
  }

  const wxCond = document.getElementById('wx-cond');
  const wxWind = document.getElementById('wx-wind');
  const wxSub  = document.getElementById('wx-sub');
  const wxIcon = document.getElementById('wx-icon');
  if (wxCond && SBSData.twd != null) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const dir   = dirs[Math.round(SBSData.twd / 22.5) % 16];
    const force = SBSData.tws != null ? Math.min(12, Math.ceil(SBSData.tws / 2.5)) : 0;
    wxCond.textContent = `${dir} BREEZE · FORCE ${force || '—'}`;
  }
  if (wxIcon && SBSData.tws != null) {
    const kt = SBSData.tws;
    wxIcon.textContent = kt >= 34 ? '🌀' : kt >= 22 ? '⛵' : kt >= 11 ? '🌬' : '😌';
  }
  if (wxWind) wxWind.innerHTML = SBSData.tws != null
    ? `${SBSData.fmt(SBSData.tws, 1)} <span style="font-size:var(--s-sm);color:var(--t-muted)">KT</span>` : '---';
  if (wxSub) wxSub.textContent = SBSData.pressure != null
    ? `${SBSData.fmt(SBSData.pressure, 0)} hPa · Live from SignalK` : 'Live from SignalK';
});

// ═══════════════════════════════════════════════════════════════
// WEATHER — Open-Meteo forecast
// ═══════════════════════════════════════════════════════════════
const WX_CACHE_KEY = 'sbs-wx-cache';
// wxData declared at top of file to avoid TDZ — see line 1

const WX_CODES = {
  0:'☀️', 1:'🌤', 2:'⛅', 3:'☁️',
  45:'🌫', 48:'🌫',
  51:'🌦', 53:'🌦', 55:'🌧',
  61:'🌧', 63:'🌧', 65:'🌧',
  71:'🌨', 73:'🌨', 75:'❄️',
  80:'🌦', 81:'🌧', 82:'⛈',
  95:'⛈', 96:'⛈', 99:'⛈',
};

async function fetchWeather(force = false) {
  const pos  = SBSData.position;
  const lat  = pos?.latitude  ?? 47.6062;
  const lon  = pos?.longitude ?? -122.3321;

  // Use cache if fresh (< 90 min) and not forcing
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(WX_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < 90 * 60000 && cached.lat === Math.round(lat * 10)) {
        wxData = cached.data;
        // Defer slightly so the panel finishes layout before canvas size is read
        setTimeout(renderWeather, 80);
        return;
      }
    } catch (e) {}
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
      + `&hourly=windspeed_10m,winddirection_10m,precipitation_probability,weathercode`
      + `&forecast_days=2&wind_speed_unit=kn&timezone=auto&forecast_hours=25`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('open-meteo error');
    wxData = await res.json();
    localStorage.setItem(WX_CACHE_KEY, JSON.stringify({ ts: Date.now(), lat: Math.round(lat * 10), data: wxData }));
    renderWeather();
    const el = document.getElementById('wx-fr-updated');
    if (el) el.textContent = new Date().toUTCString().slice(17, 22) + ' UTC';
  } catch (e) {
    console.warn('Weather fetch failed:', e);
    const el = document.getElementById('wx-fr-src');
    if (el) el.textContent = 'Offline';
  }
}

function renderWeather() {
  if (!wxData?.hourly) return;
  const h = wxData.hourly;
  const now = new Date();
  const curHour = now.getHours();

  // Find index of current hour in the data
  const times  = h.time;
  const speeds = h.windspeed_10m;
  const dirs   = h.winddirection_10m;
  const precip = h.precipitation_probability;
  const codes  = h.weathercode;

  const startIdx = times.findIndex(t => {
    const d = new Date(t);
    return d.getHours() === curHour && d.getDate() === now.getDate();
  });
  const si = startIdx >= 0 ? startIdx : 0;

  // Populate current-conditions hero from forecast when live SK data isn't available
  const wxCond = document.getElementById('wx-cond');
  const wxWind = document.getElementById('wx-wind');
  const wxIcon = document.getElementById('wx-icon');
  const wxSub  = document.getElementById('wx-sub');
  if (SBSData.tws == null && speeds[si] != null) {
    const kt  = speeds[si];
    const dir = h.winddirection_10m[si];
    const dirs16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const dirStr = dirs16[Math.round(dir / 22.5) % 16];
    const force = Math.min(12, Math.ceil(kt / 2.5));
    if (wxCond) wxCond.textContent = `${dirStr} · FORCE ${force || '0'} · FORECAST`;
    if (wxWind) wxWind.innerHTML = `${Math.round(kt)} <span style="font-size:var(--s-sm);color:var(--t-muted)">KT</span>`;
    if (wxIcon) wxIcon.textContent = kt >= 34 ? '🌀' : kt >= 22 ? '⛵' : kt >= 11 ? '🌬' : '😌';
    if (wxSub)  wxSub.textContent  = WX_CODES[codes[si]] ? `${WX_CODES[codes[si]]} Open-Meteo Forecast` : 'Open-Meteo Forecast';
  }

  // Forecast strip: NOW, +6, +12, +18, +24
  const strip = document.getElementById('wx-strip');
  if (strip) {
    const offsets = [0, 6, 12, 18, 24];
    strip.innerHTML = offsets.map(off => {
      const i = si + off;
      if (i >= speeds.length) return '';
      const kt  = speeds[i];
      const dir = dirs[i];
      const pct = precip[i];
      const ico = WX_CODES[codes[i]] ?? '🌬';
      const label = off === 0 ? 'NOW' : `+${off}H`;
      const col = kt >= 34 ? 'var(--c-red)' : kt >= 22 ? 'var(--c-amber-hi)' : 'var(--t-value)';
      const dirs16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      const dirStr = dirs16[Math.round(dir / 22.5) % 16];
      return `<div class="wx-cell">
        <div class="wt">${label}</div>
        <div class="wi">${ico}</div>
        <div class="ww" style="color:${col}">${Math.round(kt)}kt</div>
        <div class="wv" style="color:var(--c-cyan)">${dirStr}${pct > 30 ? ' ' + pct + '%' : ''}</div>
      </div>`;
    }).join('');
  }

  // Wind chart
  drawWindChart(speeds.slice(si, si + 25), dirs.slice(si, si + 25));
  drawPrecipChart(precip.slice(si, si + 25), codes.slice(si, si + 25));
}

function drawWindChart(speeds, winddirs) {
  const canvas = document.getElementById('wx-wind-chart');
  if (!canvas || !canvas.offsetWidth) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const pad = { t: 6, r: 8, b: 18, l: 30 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;

  ctx.clearRect(0, 0, W, H);

  const maxKt = Math.max(40, ...speeds.filter(Boolean)) * 1.1;
  const pts = speeds.length;

  // Grid lines
  ctx.strokeStyle = 'rgba(30,46,58,0.7)';
  ctx.lineWidth = 1;
  [10, 20, 30, 40].forEach(kt => {
    if (kt > maxKt) return;
    const y = pad.t + iH * (1 - kt / maxKt);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(74,96,112,0.8)';
    ctx.font = `9px var(--font-mono, monospace)`;
    ctx.textAlign = 'right';
    ctx.fillText(kt, pad.l - 4, y + 3);
  });

  // Beaufort alert zones
  ctx.fillStyle = 'rgba(239,68,68,0.06)';
  const galeY = pad.t + iH * (1 - 34 / maxKt);
  ctx.fillRect(pad.l, pad.t, iW, Math.max(0, galeY - pad.t));

  // Wind speed gradient fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + iH);
  grad.addColorStop(0, 'rgba(232,148,10,0.5)');
  grad.addColorStop(1, 'rgba(232,148,10,0.02)');
  ctx.beginPath();
  speeds.forEach((v, i) => {
    const x = pad.l + (i / (pts - 1)) * iW;
    const y = pad.t + iH * (1 - (v || 0) / maxKt);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + iW, pad.t + iH);
  ctx.lineTo(pad.l, pad.t + iH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Wind speed line
  ctx.beginPath();
  ctx.strokeStyle = '#e8940a';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  speeds.forEach((v, i) => {
    const x = pad.l + (i / (pts - 1)) * iW;
    const y = pad.t + iH * (1 - (v || 0) / maxKt);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // X axis time labels (0, 6, 12, 18, 24)
  ctx.fillStyle = 'rgba(74,96,112,0.9)';
  ctx.font = '9px var(--font-mono, monospace)';
  ctx.textAlign = 'center';
  [0, 6, 12, 18, 24].forEach(h => {
    if (h >= pts) return;
    const x = pad.l + (h / (pts - 1)) * iW;
    ctx.fillText(h === 0 ? 'NOW' : `+${h}h`, x, H - 4);
  });
}

function drawPrecipChart(precip, codes) {
  const canvas = document.getElementById('wx-precip-chart');
  if (!canvas || !canvas.offsetWidth) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const pad = { t: 4, r: 8, b: 14, l: 30 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;

  ctx.clearRect(0, 0, W, H);

  const barW = iW / precip.length;
  precip.forEach((pct, i) => {
    if (!pct) return;
    const x = pad.l + i * barW;
    const bH = (pct / 100) * iH;
    const code = codes[i] ?? 0;
    const isSnow = code >= 71 && code <= 77;
    ctx.fillStyle = isSnow ? 'rgba(160,200,255,0.7)' : 'rgba(59,130,246,0.6)';
    ctx.fillRect(x + 1, pad.t + iH - bH, barW - 2, bH);
  });

  // Labels
  ctx.fillStyle = 'rgba(74,96,112,0.9)';
  ctx.font = '9px var(--font-mono, monospace)';
  ctx.textAlign = 'right';
  ctx.fillText('100%', pad.l - 4, pad.t + 8);
  ctx.textAlign = 'center';
  [0, 6, 12, 18, 24].forEach(h => {
    if (h >= precip.length) return;
    const x = pad.l + (h / (precip.length - 1)) * iW;
    ctx.fillText(h === 0 ? 'NOW' : `+${h}h`, x, H - 2);
  });
}

// ═══════════════════════════════════════════════════════════════
// TIDES — NOAA CO-OPS API
// ═══════════════════════════════════════════════════════════════
const TIDE_STATION   = '9447130';  // Seattle, Puget Sound
const TIDE_STATION_NAME = 'Seattle';
const TIDE_CACHE_KEY = 'sbs-tide-cache';
let tideData = null;

async function fetchTides(force = false) {
  // Use cache if same calendar day and not forcing
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(TIDE_CACHE_KEY) || 'null');
      const today = new Date().toDateString();
      if (cached && cached.day === today && cached.station === TIDE_STATION) {
        tideData = cached.data;
        renderTides();
        return;
      }
    } catch (e) {}
  }
  try {
    const today = new Date();
    const yyyymmdd = today.getFullYear()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
      + `?begin_date=${yyyymmdd}&range=48&station=${TIDE_STATION}`
      + `&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english`
      + `&application=sailboatserver&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('NOAA tides error');
    tideData = await res.json();
    localStorage.setItem(TIDE_CACHE_KEY, JSON.stringify({
      day: today.toDateString(), station: TIDE_STATION, data: tideData
    }));
    renderTides();
  } catch (e) {
    console.warn('Tides fetch failed:', e);
    const el = document.getElementById('tide-station-name');
    if (el) el.textContent = `Tides — ${TIDE_STATION_NAME} (offline)`;
  }
}

function renderTides() {
  if (!tideData?.predictions) return;
  const preds = tideData.predictions;          // [{t: "2026-03-10 00:00", v: "2.3"}, ...]
  const vals  = preds.map(p => parseFloat(p.v));
  const times = preds.map(p => p.t);

  const stEl = document.getElementById('tide-station-name');
  if (stEl) stEl.textContent = `Tides — ${TIDE_STATION_NAME}`;

  // Find current hour index
  const now = new Date();
  const curIdx = times.findIndex(t => {
    const d = new Date(t.replace(' ', 'T'));
    return d.getDate() === now.getDate() && d.getHours() === now.getHours();
  });
  const si = Math.max(0, curIdx >= 0 ? curIdx : 0);

  // Strip: high/low points in next 24h
  const strip = document.getElementById('tide-strip');
  if (strip) {
    const extremes = [];
    for (let i = si + 1; i < Math.min(si + 24, vals.length - 1); i++) {
      if (vals[i] > vals[i - 1] && vals[i] > vals[i + 1]) extremes.push({ i, type: 'H' });
      if (vals[i] < vals[i - 1] && vals[i] < vals[i + 1]) extremes.push({ i, type: 'L' });
    }
    const first8 = extremes.slice(0, 8);
    if (first8.length === 0) {
      strip.innerHTML = '<div class="wx-cell"><div class="wt">—</div><div class="wi">🌊</div><div class="ww">--</div><div class="wv">ft</div></div>';
    } else {
      strip.innerHTML = first8.map(({ i, type }) => {
        const t = times[i].slice(11, 16);
        const v = vals[i].toFixed(1);
        const col = type === 'H' ? 'var(--c-blue)' : 'var(--t-muted)';
        return `<div class="wx-cell">
          <div class="wt">${t}</div>
          <div class="wi">${type === 'H' ? '🌊' : '⬇️'}</div>
          <div class="ww" style="color:${col}">${v}</div>
          <div class="wv">ft ${type}</div>
        </div>`;
      }).join('');
    }
  }

  drawTideChart(vals.slice(0, 48), times.slice(0, 48), si);
}

function drawTideChart(vals, times, curIdx) {
  const canvas = document.getElementById('tide-chart');
  if (!canvas || !canvas.offsetWidth) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const pad = { t: 6, r: 8, b: 18, l: 30 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;

  ctx.clearRect(0, 0, W, H);

  const minV = Math.min(...vals) - 0.5;
  const maxV = Math.max(...vals) + 0.5;
  const range = maxV - minV;
  const pts = vals.length;
  const xOf = i => pad.l + (i / (pts - 1)) * iW;
  const yOf = v => pad.t + iH * (1 - (v - minV) / range);

  // Zero/MLLW line
  const y0 = yOf(0);
  ctx.strokeStyle = 'rgba(30,46,58,0.9)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(pad.l + iW, y0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(74,96,112,0.6)'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
  ctx.fillText('0', pad.l - 4, y0 + 3);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + iH);
  grad.addColorStop(0, 'rgba(59,130,246,0.45)');
  grad.addColorStop(1, 'rgba(59,130,246,0.03)');
  ctx.beginPath();
  vals.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.lineTo(xOf(pts - 1), pad.t + iH);
  ctx.lineTo(pad.l, pad.t + iH);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Tide curve line
  ctx.beginPath(); ctx.strokeStyle = 'var(--c-blue, #3b82f6)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  vals.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.stroke();

  // Current time marker
  if (curIdx >= 0 && curIdx < pts) {
    const cx = xOf(curIdx);
    ctx.strokeStyle = 'var(--c-amber, #e8940a)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, pad.t); ctx.lineTo(cx, pad.t + iH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'var(--c-amber, #e8940a)';
    ctx.beginPath(); ctx.arc(cx, yOf(vals[curIdx]), 4, 0, Math.PI * 2); ctx.fill();
    // Current tide label
    ctx.fillStyle = 'rgba(74,96,112,0.9)'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText(vals[curIdx].toFixed(1) + 'ft', pad.l - 4, yOf(vals[curIdx]) + 3);
  }

  // X axis: midnight labels
  ctx.fillStyle = 'rgba(74,96,112,0.9)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  times.forEach((t, i) => {
    const hr = t.slice(11, 13);
    if (hr === '00' || hr === '06' || hr === '12' || hr === '18') {
      ctx.fillText(hr === '00' ? t.slice(5, 10) : `${hr}:00`, xOf(i), H - 2);
    }
  });
}

// Set hostname-relative links for services running on the Pi
(function initResourceLinks() {
  const h = window.location.hostname;
  const sk = document.getElementById('link-signalk');
  if (sk) sk.href = `http://${h}:3000`;
})();

// Open Plan tab when landing with #plan hash (e.g. from REPLAN button)
if (window.location.hash === '#plan') {
  document.querySelector('[data-tab="plan"]')?.click();
}

// Init chart on default active panel
if (document.querySelector('[data-panel="charts"]')?.classList.contains('active') && typeof SBSChart !== 'undefined') {
  SBSChart.init();
  SBSChart.update();
}

// Bottom nav
if (typeof SBSNav !== 'undefined') SBSNav.init();
