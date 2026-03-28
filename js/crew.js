/* ============================================================
   CREW.JS — Crew View logic
   Reads from SBSData (read-only). Relay toggles use SBSData.toggleRelay.
   ============================================================ */

// ── HELPERS ───────────────────────────────────────────────────

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function fmt(val, dec = 1, fallback = '--') {
  return val != null && isFinite(val) ? val.toFixed(dec) : fallback;
}

function fmtBearing(deg) {
  if (deg == null) return '---';
  return Math.round(((deg % 360) + 360) % 360).toString().padStart(3, '0');
}

// ── INSTRUMENTS ───────────────────────────────────────────────

function updateInstruments() {
  const d = SBSData;

  // SOG
  setText('c-sog', fmt(d.sog));

  // COG
  setText('c-cog', fmtBearing(d.cog));

  // Depth
  const depth = d.depth;
  setText('c-depth', fmt(depth, 1));
  const depthCard = document.getElementById('c-depth-card');
  const shallowBadge = document.getElementById('c-shallow');
  const SHALLOW_M = 3;
  if (depth != null && depth < SHALLOW_M) {
    depthCard?.classList.add('crew-depth-shallow');
    if (shallowBadge) shallowBadge.style.display = '';
  } else {
    depthCard?.classList.remove('crew-depth-shallow');
    if (shallowBadge) shallowBadge.style.display = 'none';
  }

  // Wind — TWS hero, AWS + AWA secondary
  setText('c-tws', fmt(d.tws, 0, '--'));
  const aws = d.aws != null ? `AWS ${fmt(d.aws, 0)}kt` : 'AWS --kt';
  const awa = d.awa != null ? `AWA ${fmt(d.awa, 0)}°` : 'AWA --°';
  setText('c-aws-label', aws);
  setText('c-awa-label', awa);

  // TWD
  setText('c-twd', fmtBearing(d.twd));

  // Baro
  const baro = d.pressure;
  setText('c-baro', baro != null ? Math.round(baro).toString() : '----');

  // Baro trend — not in SBSData yet, hide the element
  const trendEl = document.getElementById('c-baro-trend');
  if (trendEl) trendEl.textContent = '';

  // Air temp
  setText('c-airtemp', fmt(d.temp, 1));

  // Humidity
  setText('c-humidity', d.humidity != null ? Math.round(d.humidity).toString() : '--');
}

// ── PASSAGE ───────────────────────────────────────────────────

function updatePassage() {
  const container = document.getElementById('c-passage-content');
  if (!container) return;

  const p = SBSData.passage;
  if (!p || !p.waypoints || p.waypoints.length === 0) {
    container.innerHTML = '<div class="crew-no-passage">No active passage</div>';
    return;
  }

  const wps = p.waypoints;
  const nextIdx = p.nextWPIndex ?? 0;
  const nextWP = wps[nextIdx];

  // Progress
  const totalDist = p.totalDistance;
  const distDone = p.distanceDone;
  const pct = (totalDist > 0 && distDone != null) ? Math.round((distDone / totalDist) * 100) : null;
  const eta = p.eta ? new Date(p.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const origin = wps[0]?.name || 'START';
  const dest = wps[wps.length - 1]?.name || 'END';

  // Upcoming waypoints: current + next 2
  const upcomingWPs = wps.slice(nextIdx, nextIdx + 3);

  let html = `
    <div class="crew-next-wp">
      <div class="crew-next-wp-label">NEXT WAYPOINT</div>
      <div class="crew-next-wp-name">${nextWP?.name || 'WP ' + (nextIdx + 1)}</div>
      <div class="crew-wp-stats">
        <div class="crew-wp-stat">
          <span class="label">BRG</span>
          <span class="value">${fmtBearing(nextWP?.bearing)}°</span>
        </div>
        <div class="crew-wp-stat">
          <span class="label">DIST</span>
          <span class="value">${fmt(nextWP?.distance, 1, '--')}</span>
          <span class="unit">NM</span>
        </div>
        <div class="crew-wp-stat">
          <span class="label">ETA</span>
          <span class="value">${eta || '--:--'}</span>
        </div>
        <div class="crew-wp-stat">
          <span class="label">VMG</span>
          <span class="value" style="color:var(--c-cyan)">${fmt(p.vmg, 1, '--')}</span>
          <span class="unit">KT</span>
        </div>
      </div>
    </div>`;

  // Progress bar
  if (pct != null) {
    html += `
    <div class="crew-progress-bar">
      <div class="crew-progress-labels">
        <span>${origin}</span><span>${dest}</span>
      </div>
      <div class="crew-progress-track">
        <div class="crew-progress-fill" style="width:${pct}%"></div>
        <div class="crew-progress-dot" style="left:${pct}%"></div>
      </div>
      <div class="crew-progress-pct">${pct}% COMPLETE${totalDist ? ` — ${fmt(totalDist, 1)} NM TOTAL` : ''}</div>
    </div>`;
  }

  // Upcoming waypoints list (beyond next)
  if (upcomingWPs.length > 1) {
    html += `<div class="crew-wp-list">`;
    upcomingWPs.forEach((wp, i) => {
      const globalIdx = nextIdx + i;
      const isCurrent = i === 0;
      html += `
      <div class="crew-wp-row${isCurrent ? ' crew-wp-row--current' : ''}">
        <span class="crew-wp-row-num">${globalIdx + 1}</span>
        <span class="crew-wp-row-name">${wp.name || 'WP ' + (globalIdx + 1)}</span>
        <span class="crew-wp-row-dist">${wp.distance != null ? fmt(wp.distance, 1) + ' NM' : ''}</span>
      </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

// ── FORECAST STRIP ────────────────────────────────────────────

function updateForecast() {
  const strip = document.getElementById('c-forecast-strip');
  if (!strip) return;

  const forecast = SBSData.forecast;
  if (!forecast || forecast.length === 0) {
    strip.innerHTML = '<div class="crew-no-forecast">No forecast data</div>';
    return;
  }

  const now = Date.now();
  // Show next 8 entries
  const entries = forecast.filter(f => new Date(f.time).getTime() >= now - 3600000).slice(0, 8);
  if (entries.length === 0) {
    strip.innerHTML = '<div class="crew-no-forecast">No forecast data</div>';
    return;
  }

  const maxWind = Math.max(...entries.map(f => f.wind ?? 0), 1);

  strip.innerHTML = entries.map((f, i) => {
    const t = new Date(f.time);
    const hr = t.getHours().toString().padStart(2, '0') + ':00';
    const wind = f.wind != null ? Math.round(f.wind) : '--';
    const dir = f.windDir || '';
    const barH = f.wind != null ? Math.round((f.wind / maxWind) * 36) : 4;
    const isNow = i === 0;
    return `
    <div class="crew-forecast-cell${isNow ? ' crew-forecast-cell--now' : ''}">
      <div class="crew-fc-time">${isNow ? 'NOW' : hr}</div>
      <div class="crew-fc-wind">${wind}</div>
      <div class="crew-fc-unit">KT</div>
      <div class="crew-fc-dir">${dir}</div>
      <div class="crew-fc-bar-wrap"><div class="crew-fc-bar" style="height:${barH}px"></div></div>
    </div>`;
  }).join('');
}

// ── MAIN UPDATE ───────────────────────────────────────────────

function crewUpdate() {
  updateInstruments();
  updatePassage();
  updateForecast();
}

SBSData.on('update', crewUpdate);
SBSData.on('temperatures', t => {
  setText('c-cabintemp', t.cabin != null ? t.cabin.toFixed(1) : '--.-');
});
crewUpdate(); // initial render

// Bottom nav
if (typeof SBSNav !== 'undefined') SBSNav.init();
