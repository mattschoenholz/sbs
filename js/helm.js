/* Helm-specific logic — runs after sbs-data.js and sbs-components.js */

// ── TAB SWITCHING ─────────────────────────────────────────
document.querySelectorAll('.helm-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.helm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.helm-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
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
    dt.classList.toggle('critical', d != null && d < 1);
    dt.classList.toggle('shallow',  d != null && d >= 1 && d < 3);
  }

  if (!apEngaged) {
    apTarget = SBSData.heading != null ? Math.round(SBSData.heading) : apTarget;
    const aph = document.getElementById('v-ap-hdg');
    if (aph) aph.textContent = apTarget != null ? apTarget + '°' : '---°';
  }

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
});

// ── AUTOPILOT STATE ───────────────────────────────────────
let apEngaged = false;
let apTarget  = null;

function apToggle() {
  apEngaged = !apEngaged;
  const btn = document.getElementById('ap-engage-btn');
  const sts = document.getElementById('ap-status');
  if (apEngaged) {
    apTarget = SBSData.heading != null ? Math.round(SBSData.heading) : (apTarget || 0);
    if (btn) { btn.textContent = 'ENGAGED'; btn.classList.add('active'); }
    if (sts) { sts.textContent = `STEERING ${apTarget}°`; sts.style.color = 'var(--c-green)'; }
  } else {
    if (btn) { btn.textContent = 'STBY'; btn.classList.remove('active'); }
    if (sts) { sts.textContent = 'STANDBY'; sts.style.color = ''; }
  }
}

function apAdjust(delta) {
  if (!apEngaged) return;
  apTarget = ((apTarget || 0) + delta + 360) % 360;
  const aph = document.getElementById('v-ap-hdg');
  const sts = document.getElementById('ap-status');
  if (aph) aph.textContent = apTarget + '°';
  if (sts) sts.textContent = `STEERING ${apTarget}°`;
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

function buildForecastStrip() {
  const strip = document.getElementById('wx-strip');
  if (!strip) return;
  const now   = Date.now();
  const slots = Array.from({length: 8}, (_, i) => {
    const t    = new Date(now + i * 3 * 3600000);
    const ts   = t.toUTCString().slice(17,22) + 'z';
    const wind = 12 + Math.round(Math.sin(i * 0.8) * 5);
    const wave = (0.8 + Math.sin(i * 0.5) * 0.4).toFixed(1);
    return `<div class="wx-strip-cell">
      <span class="wsc-time">${ts}</span>
      <span class="wsc-wind">${wind}kn</span>
      <span class="wsc-wave">${wave}m</span>
    </div>`;
  });
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

buildForecastStrip();
updatePassageTab();
