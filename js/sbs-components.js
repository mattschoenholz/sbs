/* ============================================================
   SBS-COMPONENTS.JS — Reusable Web Components
   Used by both index.html (portal) and helm.html

   Components:
     <instrument-cell>   — single data readout (SOG, COG, etc.)
     <wind-gauge>        — circular wind direction + speed
     <depth-display>     — depth with shallow water warning
     <relay-button>      — relay toggle with on/off state
     <bilge-status>      — bilge wet/dry indicator
     <compass-rose>      — heading/COG compass
     <alert-banner>      — urgent/advisory sliding banner
     <night-toggle>      — night mode button
     <connection-status> — SignalK + relay connection dots
   ============================================================ */

// ── HELPERS ───────────────────────────────────────────────────

function css(strings, ...vals) {
  return strings.reduce((acc, str, i) => acc + str + (vals[i] || ''), '');
}

// Base class — handles SBSData subscription lifecycle
class SBSComponent extends HTMLElement {
  connectedCallback() {
    this._unsub = SBSData.on('update', () => this.render());
    this.render();
  }
  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }
  render() {}
}

// ── INSTRUMENT CELL ───────────────────────────────────────────
// <instrument-cell key="sog" label="SOG" unit="kn" size="lg">
// key maps to SBSData[key]
// size: sm | md | lg | xl

customElements.define('instrument-cell', class extends SBSComponent {
  render() {
    const key   = this.getAttribute('key');
    const label = this.getAttribute('label') || key?.toUpperCase();
    const unit  = this.getAttribute('unit') || '';
    const size  = this.getAttribute('size') || 'md';
    const dec   = parseInt(this.getAttribute('decimals') || '1');
    const bear  = this.hasAttribute('bearing');

    const raw = key ? SBSData[key] : null;
    const val = raw == null ? '---'
      : bear ? SBSData.fmtBearing(raw)
      : SBSData.fmt(raw, dec);

    const sizeMap = { sm: '1.4rem', md: '2rem', lg: '2.8rem', xl: '4rem' };
    const fontSize = sizeMap[size] || '2rem';

    this.innerHTML = `
      <div class="inst-cell${raw == null ? ' stale' : ''}">
        <span class="label">${label}</span>
        <span class="value" style="font-size:${fontSize}">${val}</span>
        ${unit ? `<span class="unit">${unit}</span>` : ''}
      </div>`;
  }
});

// ── WIND GAUGE ────────────────────────────────────────────────
// <wind-gauge mode="true|apparent" size="200">
// Circular gauge showing wind direction arrow + speed

customElements.define('wind-gauge', class extends SBSComponent {
  connectedCallback() {
    this._unsub = SBSData.on('update', () => this.render());
    this.style.display = 'block';
    this.render();
  }

  render() {
    const mode   = this.getAttribute('mode') || 'true';
    const size   = parseInt(this.getAttribute('size') || '180');
    const isTrue = mode === 'true';

    const speed = isTrue ? SBSData.tws : SBSData.aws;
    const dir   = isTrue ? SBSData.twd : SBSData.awa;
    const label = isTrue ? 'TWS' : 'AWS';
    const dirLabel = isTrue ? 'TWD' : 'AWA';

    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 8;
    const arrowAngle = dir != null ? dir : 0;
    const rad = (arrowAngle - 90) * Math.PI / 180;
    const arrowLen = r * 0.65;
    const ax = cx + Math.cos(rad) * arrowLen;
    const ay = cy + Math.sin(rad) * arrowLen;
    const tailRad = rad + Math.PI;
    const tx = cx + Math.cos(tailRad) * (arrowLen * 0.4);
    const ty = cy + Math.sin(tailRad) * (arrowLen * 0.4);

    // Wind speed color
    const spd = speed || 0;
    const windColor = spd > 25 ? '#ef4444'
      : spd > 15 ? '#eab308'
      : '#e8940a';

    // Cardinal marks
    const cardinals = ['N','E','S','W'];
    const cardinalSVG = cardinals.map((c, i) => {
      const a = (i * 90 - 90) * Math.PI / 180;
      const cr = r + 4;
      const x = cx + Math.cos(a) * (r - 14);
      const y = cy + Math.sin(a) * (r - 14);
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
        font-family="'Barlow Condensed',sans-serif" font-size="10" font-weight="600"
        fill="#4a6070">${c}</text>`;
    }).join('');

    // Tick marks
    const ticks = Array.from({length: 36}, (_, i) => {
      const a = (i * 10 - 90) * Math.PI / 180;
      const major = i % 9 === 0;
      const inner = r - (major ? 8 : 4);
      const x1 = cx + Math.cos(a) * inner;
      const y1 = cy + Math.sin(a) * inner;
      const x2 = cx + Math.cos(a) * r;
      const y2 = cy + Math.sin(a) * r;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${major ? '#2a3f50' : '#1e2e3a'}" stroke-width="${major ? 1.5 : 1}"/>`;
    }).join('');

    this.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <!-- Outer ring -->
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
            stroke="#1e2e3a" stroke-width="1.5"/>
          <!-- Inner fill -->
          <circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="#0d1318"/>

          ${ticks}
          ${cardinalSVG}

          ${dir != null ? `
          <!-- Arrow shaft -->
          <line x1="${tx}" y1="${ty}" x2="${ax}" y2="${ay}"
            stroke="${windColor}" stroke-width="2.5" stroke-linecap="round"/>
          <!-- Arrowhead -->
          <polygon points="${ax},${ay}
            ${cx + Math.cos(rad - 0.4) * (arrowLen * 0.75)},${cy + Math.sin(rad - 0.4) * (arrowLen * 0.75)}
            ${cx + Math.cos(rad + 0.4) * (arrowLen * 0.75)},${cy + Math.sin(rad + 0.4) * (arrowLen * 0.75)}"
            fill="${windColor}"/>
          <!-- Tail dot -->
          <circle cx="${tx}" cy="${ty}" r="3" fill="${windColor}" opacity="0.5"/>
          ` : `
          <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
            font-family="'Share Tech Mono',monospace" font-size="12" fill="#4a6070">---</text>
          `}

          <!-- Center speed display -->
          <text x="${cx}" y="${cy - 6}" text-anchor="middle"
            font-family="'Share Tech Mono',monospace"
            font-size="${size > 160 ? 22 : 16}" fill="${windColor}" font-weight="bold">
            ${SBSData.fmt(speed, 1)}
          </text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle"
            font-family="'Barlow Condensed',sans-serif"
            font-size="10" fill="#4a6070" letter-spacing="0.08em">
            ${label} KN
          </text>
        </svg>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;
          letter-spacing:0.08em;color:#4a6070;text-transform:uppercase">
          ${dirLabel}: ${SBSData.fmtBearing(dir)}
        </div>
      </div>`;
  }
});

// ── DEPTH DISPLAY ─────────────────────────────────────────────
// <depth-display shallow="3" critical="1">
// Turns yellow at shallow threshold, red at critical

customElements.define('depth-display', class extends SBSComponent {
  render() {
    const shallow  = parseFloat(this.getAttribute('shallow')  || '3');
    const critical = parseFloat(this.getAttribute('critical') || '1');
    const depth    = SBSData.depth;

    const color = depth == null ? 'var(--t-muted)'
      : depth < critical  ? 'var(--c-red)'
      : depth < shallow   ? 'var(--c-yellow)'
      : 'var(--c-cyan)';

    const glow = depth != null && depth < critical
      ? 'var(--shadow-red)' : 'none';

    this.innerHTML = `
      <div class="inst-cell" style="border-color:${color};box-shadow:${glow}">
        <span class="label">DEPTH</span>
        <span class="value" style="font-size:2.8rem;color:${color}">
          ${SBSData.fmt(depth, 1)}
        </span>
        <span class="unit">m</span>
        ${depth != null && depth < shallow
          ? `<span style="font-family:'Barlow Condensed',sans-serif;font-size:10px;
              letter-spacing:0.1em;text-transform:uppercase;color:${color};margin-top:2px">
              ${depth < critical ? '⚠ CRITICAL' : 'SHALLOW'}
             </span>`
          : ''}
      </div>`;
  }
});

// ── RELAY BUTTON ──────────────────────────────────────────────
// <relay-button channel="4" name="Bilge Pump" icon="💧">

customElements.define('relay-button', class extends HTMLElement {
  connectedCallback() {
    this._unsubRelay  = SBSData.on('relays', () => this.render());
    this._unsubUpdate = SBSData.on('update', () => this.render());
    this.render();
  }

  disconnectedCallback() {
    if (this._unsubRelay)  this._unsubRelay();
    if (this._unsubUpdate) this._unsubUpdate();
  }

  render() {
    const ch   = parseInt(this.getAttribute('channel'));
    const name = this.getAttribute('name') || `CH${ch}`;
    const icon = this.getAttribute('icon') || '⚡';
    const on   = SBSData.relays[ch] === true;

    this.innerHTML = `
      <button class="relay-btn${on ? ' on' : ''}" data-ch="${ch}">
        <span class="icon">${icon}</span>
        <span class="name">${name}</span>
        <span class="relay-state">${on ? 'ON' : 'OFF'}</span>
      </button>`;

    this.querySelector('button').addEventListener('click', async () => {
      await SBSData.toggleRelay(ch, !on);
    });
  }
});

// ── BILGE STATUS ──────────────────────────────────────────────
// <bilge-status> — shows dry/wet with visual indicator

customElements.define('bilge-status', class extends SBSComponent {
  render() {
    const wet = SBSData.bilge;
    this.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;
        padding:6px 12px;border-radius:6px;
        background:${wet ? 'rgba(127,29,29,0.4)' : 'rgba(20,83,45,0.3)'};
        border:1px solid ${wet ? 'var(--c-red)' : 'var(--c-green-dim)'};
        box-shadow:${wet ? 'var(--shadow-red)' : 'none'}">
        <span style="font-size:16px">${wet ? '💧' : '✓'}</span>
        <span style="font-family:'Barlow Condensed',sans-serif;
          font-size:12px;font-weight:600;letter-spacing:0.1em;
          text-transform:uppercase;
          color:${wet ? 'var(--c-red)' : 'var(--c-green)'}">
          BILGE ${wet ? 'WET' : 'DRY'}
        </span>
      </div>`;
  }
});

// ── NAV PANEL ─────────────────────────────────────────────────
// <nav-panel> — compact 2x2 COG, SOG, BTW, DTW (BTW/DTW when passage active)
customElements.define('nav-panel', class extends SBSComponent {
  connectedCallback() {
    this._unsubUpdate = SBSData.on('update', () => this.render());
    this._unsubPassage = SBSData.on('passage:updated', () => this.render());
    this.style.display = 'block';
    this.render();
  }
  disconnectedCallback() {
    if (this._unsubUpdate) this._unsubUpdate();
    if (this._unsubPassage) this._unsubPassage();
  }
  render() {
    const p = SBSData.passage;
    const wp = p.active && p.waypoints.length && p.nextWPIndex < p.waypoints.length
      ? p.waypoints[p.nextWPIndex] : null;
    const btw = wp?.bearing;
    const dtw = wp?.distance;
    this.innerHTML = `
      <div class="nav-panel">
        <div class="ndc"><span class="ndc-lbl">COG</span><div class="ndc-val">${SBSData.fmtBearing(SBSData.cog)}</div></div>
        <div class="ndc"><span class="ndc-lbl">SOG</span><div class="ndc-val">${SBSData.fmt(SBSData.sog, 1)}<span class="ndc-unit">kt</span></div></div>
        <div class="ndc"><span class="ndc-lbl">BTW</span><div class="ndc-val">${btw != null ? SBSData.fmtBearing(btw) : '---'}</div></div>
        <div class="ndc"><span class="ndc-lbl">DTW</span><div class="ndc-val">${dtw != null ? SBSData.fmt(dtw, 1) : '---'}<span class="ndc-unit">nm</span></div></div>
      </div>`;
  }
});

// ── INSTRUMENT STRIP ───────────────────────────────────────────
// <inst-strip> — horizontal strip TWS, TWD, DEPTH, BARO (accent: hi=amber, bl=blue)
customElements.define('inst-strip', class extends SBSComponent {
  render() {
    const tws = SBSData.tws;
    const twd = SBSData.twd;
    const depth = SBSData.depth;
    const baro = SBSData.pressure;
    const twdCard = twd != null ? Math.round(twd) : null;
    const dir = twdCard != null ? ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(twdCard / 22.5) % 16] : '';
    this.innerHTML = `
      <div class="manage-inst-strip">
        <div class="sg hi"><div class="sg-lbl">TWS</div><div class="sg-val">${SBSData.fmt(tws, 1)}</div><div class="sg-unit">KT</div></div>
        <div class="sg hi"><div class="sg-lbl">TWD</div><div class="sg-val">${twd != null ? Math.round(twd) + '°' : '---'}</div><div class="sg-unit">${dir}</div></div>
        <div class="sg bl"><div class="sg-lbl">DEPTH</div><div class="sg-val">${SBSData.fmt(depth, 1)}</div><div class="sg-unit">M</div></div>
        <div class="sg"><div class="sg-lbl">BARO</div><div class="sg-val">${SBSData.fmt(baro, 0)}</div><div class="sg-unit">hPa</div></div>
      </div>`;
  }
});

// ── COMPASS ROSE ──────────────────────────────────────────────
// <compass-rose mode="heading|cog" size="180">

customElements.define('compass-rose', class extends SBSComponent {
  connectedCallback() {
    this._unsub = SBSData.on('update', () => this.render());
    this.style.display = 'block';
    this.render();
  }

  render() {
    const mode  = this.getAttribute('mode') || 'cog';
    const size  = parseInt(this.getAttribute('size') || '180');
    const value = mode === 'heading' ? SBSData.heading : SBSData.cog;
    const label = mode === 'heading' ? 'HDG' : 'COG';

    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 10;

    // Rotate the compass rose so north points to current heading/COG
    const rotation = value != null ? -value : 0;

    // Cardinal + intercardinal labels
    const dirs = [
      {l:'N',a:0},{l:'NE',a:45},{l:'E',a:90},{l:'SE',a:135},
      {l:'S',a:180},{l:'SW',a:225},{l:'W',a:270},{l:'NW',a:315}
    ];

    const dirSVG = dirs.map(({l, a}) => {
      const rad = (a - 90) * Math.PI / 180;
      const dist = l.length === 1 ? r - 16 : r - 20;
      const x = cx + Math.cos(rad) * dist;
      const y = cy + Math.sin(rad) * dist;
      const isCard = l.length === 1;
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
        font-family="'Barlow Condensed',sans-serif"
        font-size="${isCard ? 13 : 9}" font-weight="${isCard ? 700 : 400}"
        fill="${l === 'N' ? '#e8940a' : isCard ? '#8fa3b3' : '#4a6070'}">${l}</text>`;
    }).join('');

    // Tick marks
    const ticks = Array.from({length: 72}, (_, i) => {
      const a = (i * 5 - 90) * Math.PI / 180;
      const major = i % 6 === 0;
      const inner = r - (major ? 10 : 5);
      const x1 = cx + Math.cos(a) * inner;
      const y1 = cy + Math.sin(a) * inner;
      const x2 = cx + Math.cos(a) * r;
      const y2 = cy + Math.sin(a) * r;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${major ? '#2a3f50' : '#1a2830'}" stroke-width="${major ? 1.5 : 1}"/>`;
    }).join('');

    // Lubber line (fixed, points up = current heading)
    const lubberLen = r - 4;

    this.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="position:relative;width:${size}px;height:${size}px">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
            style="position:absolute;top:0;left:0">
            <!-- Outer ring -->
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
              stroke="#1e2e3a" stroke-width="1.5"/>
            <!-- Inner fill -->
            <circle cx="${cx}" cy="${cy}" r="${r-1}" fill="#0a1218"/>
          </svg>

          <!-- Rotating rose -->
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
            style="position:absolute;top:0;left:0;
              transform:rotate(${rotation}deg);
              transition:transform 0.5s ease;
              transform-origin:${cx}px ${cy}px">
            ${ticks}
            ${dirSVG}
          </svg>

          <!-- Fixed lubber line + center -->
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
            style="position:absolute;top:0;left:0">
            <!-- Lubber line -->
            <line x1="${cx}" y1="${cy - lubberLen}" x2="${cx}" y2="${cy - (r-2)}"
              stroke="var(--c-amber)" stroke-width="2.5" stroke-linecap="round"/>
            <!-- Center dot -->
            <circle cx="${cx}" cy="${cy}" r="4" fill="var(--c-amber)"/>
            <!-- Value display -->
            <text x="${cx}" y="${cy + 6}" text-anchor="middle"
              font-family="'Share Tech Mono',monospace"
              font-size="18" fill="var(--t-value)">
              ${value != null ? Math.round(value).toString().padStart(3,'0') + '°' : '---'}
            </text>
          </svg>
        </div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;
          letter-spacing:0.1em;color:#4a6070;text-transform:uppercase">${label}</div>
      </div>`;
  }
});

// ── ALERT BANNER ──────────────────────────────────────────────
// <alert-banner> — auto-shows when urgent/advisory alerts fire

customElements.define('alert-banner', class extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="alert-banner" id="sbs-alert-banner">
        <span id="sbs-alert-text"></span>
        <button class="dismiss" onclick="this.closest('.alert-banner').classList.remove('show')">✕</button>
      </div>`;

    SBSData.on('alert:urgent', (alert) => {
      this._show(alert.message, 'urgent');
    });

    SBSData.on('alert:advisory', (alert) => {
      this._show(alert.message, 'advisory');
    });
  }

  _show(message, level) {
    const banner = this.querySelector('.alert-banner');
    const text   = this.querySelector('#sbs-alert-text');
    if (!banner || !text) return;
    banner.className = `alert-banner ${level}`;
    text.textContent = message;
    // Force reflow then add show
    banner.offsetHeight;
    banner.classList.add('show');
    if (level === 'advisory') {
      setTimeout(() => banner.classList.remove('show'), 8000);
    }
  }
});

// ── NIGHT TOGGLE ──────────────────────────────────────────────
// <night-toggle> — single button, toggles night mode

customElements.define('night-toggle', class extends HTMLElement {
  connectedCallback() {
    this.render();
    SBSData.on('night', () => this.render());
    this.addEventListener('click', () => SBSData.toggleNight());
  }

  render() {
    this.innerHTML = `
      <button class="sbs-btn" title="Toggle night mode"
        style="${SBSData.nightMode
          ? 'border-color:var(--c-amber-dim);color:var(--c-amber)'
          : ''}">
        ${SBSData.nightMode ? '☀' : '🌙'}
      </button>`;
  }
});

// ── CONNECTION STATUS ─────────────────────────────────────────
// <connection-status> — shows SignalK + relay + GPS dots

customElements.define('connection-status', class extends HTMLElement {
  connectedCallback() {
    SBSData.on('connected',    () => this.render());
    SBSData.on('disconnected', () => this.render());
    SBSData.on('update',       () => this.render());
    SBSData.on('stale',        () => this.render());
    this.render();
  }

  render() {
    const sk    = SBSData.connected ? 'ok' : 'err';
    const gps   = SBSData.gpsValid  ? 'ok' : 'warn';
    const bilge = SBSData.bilge     ? 'err' : 'ok';

    this.innerHTML = `
      <span class="status-dot ${sk}">SK</span>
      <span class="status-dot ${gps}">GPS</span>
      <span class="status-dot ${bilge}">BILGE</span>`;
  }
});

// ── PASSAGE NEXT WAYPOINT ─────────────────────────────────────
// <next-waypoint> — compact next WP display for helm passage tab

customElements.define('next-waypoint', class extends SBSComponent {
  render() {
    const p  = SBSData.passage;
    const wp = p.waypoints[p.nextWPIndex];

    if (!p.active || !wp) {
      this.innerHTML = `
        <div class="inst-cell" style="grid-column:span 2">
          <span class="label">NEXT WAYPOINT</span>
          <span class="value" style="font-size:1.2rem;color:var(--t-muted)">No active passage</span>
        </div>`;
      return;
    }

    this.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;
        background:var(--c-surface);border:1px solid var(--c-border);
        border-radius:var(--r-lg);padding:var(--sp-lg)">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;
          letter-spacing:0.1em;text-transform:uppercase;color:var(--t-muted)">
          NEXT WAYPOINT ${p.nextWPIndex + 1}/${p.waypoints.length}
        </div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;
          font-weight:700;color:var(--c-amber-hi)">${wp.name || 'WP ' + (p.nextWPIndex + 1)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="inst-cell">
            <span class="label">BRG</span>
            <span class="value" style="font-size:1.8rem">${wp.bearing != null ? SBSData.fmtBearing(wp.bearing) : '---'}</span>
          </div>
          <div class="inst-cell">
            <span class="label">DIST</span>
            <span class="value" style="font-size:1.8rem">${wp.distance != null ? SBSData.fmt(wp.distance, 1) : '---'}</span>
            <span class="unit">nm</span>
          </div>
        </div>
      </div>`;
  }
});

console.log('SBS Components loaded ✓');
