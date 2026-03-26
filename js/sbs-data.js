/* ============================================================
   SBS-DATA.JS — SignalK WebSocket Data Layer
   Single source of truth for all instrument data.
   Both index.html and helm.html include this file.

   Usage:
     SBSData.sog          → current speed over ground (knots)
     SBSData.on('update', fn)     → called every time data arrives
     SBSData.on('alert:urgent', fn)  → bilge, AIS, gate closing
     SBSData.on('alert:advisory', fn) → SOG below plan, ETA slip
   ============================================================ */

const SBSData = (() => {

  // ── SIGNALK CONFIG ────────────────────────────────────────
  const SK_HOST     = window.location.hostname || '192.168.8.201';
  const SK_WS_PORT  = 3000;
  const SK_API_PORT = 3000;
  const RELAY_PORT  = 5000;

  // SignalK paths we subscribe to
  const SK_PATHS = [
    'navigation.speedOverGround',
    'navigation.courseOverGroundTrue',
    'navigation.headingTrue',
    'environment.depth.belowTransducer',
    'environment.wind.speedTrue',
    'environment.wind.directionTrue',
    'environment.wind.speedApparent',
    'environment.wind.angleApparent',
    'environment.outside.pressure',
    'environment.outside.temperature',
    'environment.outside.humidity',
    'navigation.speedThroughWater',
    'navigation.position',
  ];

  // ── STATE ─────────────────────────────────────────────────
  const state = {
    // Navigation
    sog:      null,   // knots
    cog:      null,   // degrees true
    heading:  null,   // degrees true
    position: null,   // { latitude, longitude }

    // Environment
    depth:    null,   // metres
    tws:      null,   // knots
    twd:      null,   // degrees true
    aws:      null,   // knots apparent
    awa:      null,   // degrees apparent

    // Weather (from ESP32 via SignalK)
    pressure: null,   // hPa
    temp:     null,   // °C
    humidity: null,   // %

    // ESP32 direct
    stw:      null,   // knots speed through water
    bilge:    false,  // wet/dry

    // Relay states
    relays: { 1:false, 2:false, 3:false, 4:false,
              5:false, 6:false, 7:false, 8:false },

    // Passage planning
    passage: {
      active:      false,
      waypoints:   [],
      nextWPIndex: 0,
      alerts:      [],
      planSOG:     null,   // planned average SOG
      planETA:     null,   // planned ETA at destination
    },

    // AIS vessels from SignalK — keyed by context string (e.g. "vessels.urn:mrn:...")
    aisVessels: {},

    // Connection health
    connected:   false,
    lastUpdate:  null,
    gpsValid:    false,
  };

  // ── EVENT EMITTER ─────────────────────────────────────────
  const listeners = {};

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return () => off(event, fn); // returns unsubscribe fn
  }

  function off(event, fn) {
    if (listeners[event])
      listeners[event] = listeners[event].filter(f => f !== fn);
  }

  function emit(event, data) {
    (listeners[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.warn('SBSData listener error:', e); }
    });
  }

  // ── UNIT CONVERSION ───────────────────────────────────────
  const conv = {
    msToKnots:    ms  => ms != null ? ms * 1.94384 : null,
    radToDeg:     rad => rad != null ? (rad * 180 / Math.PI + 360) % 360 : null,
    paToHpa:      pa  => pa  != null ? pa / 100 : null,
    kToC:         k   => k   != null ? k - 273.15 : null,
  };

  // ── SIGNALK PATH → STATE MAPPING ──────────────────────────
  function applyValue(path, value) {
    switch (path) {
      case 'navigation.speedOverGround':
        state.sog = conv.msToKnots(value); break;
      case 'navigation.courseOverGroundTrue':
        state.cog = conv.radToDeg(value); break;
      case 'navigation.headingTrue':
        state.heading = conv.radToDeg(value); break;
      case 'navigation.speedThroughWater':
        state.stw = conv.msToKnots(value); break;
      case 'navigation.position':
        state.position = value;
        state.gpsValid = (value && value.latitude !== 0); break;
      case 'environment.depth.belowTransducer':
        state.depth = value; break;  // already in metres
      case 'environment.wind.speedTrue':
        state.tws = conv.msToKnots(value); break;
      case 'environment.wind.directionTrue':
        state.twd = conv.radToDeg(value); break;
      case 'environment.wind.speedApparent':
        state.aws = conv.msToKnots(value); break;
      case 'environment.wind.angleApparent':
        state.awa = conv.radToDeg(value); break;
      case 'environment.outside.pressure':
        state.pressure = conv.paToHpa(value); break;
      case 'environment.outside.temperature':
        state.temp = conv.kToC(value); break;
      case 'environment.outside.humidity':
        state.humidity = value != null ? value * 100 : null; break;
    }
  }

  // ── SELF CONTEXT ──────────────────────────────────────────
  // SignalK may respond to vessels.* subscriptions with the vessel's actual URN
  // (e.g. "vessels.urn:mrn:imo:mmsi:338107052") rather than "vessels.self".
  // We fetch the self path from the REST API so we can identify it correctly.
  let selfContext = null;

  async function fetchSelfContext() {
    try {
      const res = await fetch(`http://${SK_HOST}:${SK_API_PORT}/signalk/v1/api/self`);
      if (!res.ok) return;
      const text = await res.text();
      selfContext = text.replace(/^"|"$/g, '').trim();  // strip surrounding quotes
      console.log('SBSData: self context =', selfContext);
    } catch (e) { /* offline — will retry on next connect */ }
  }

  // ── AIS VESSEL TRACKING ───────────────────────────────────
  function applyAisValue(ctx, path, value) {
    if (!state.aisVessels[ctx]) state.aisVessels[ctx] = {};
    const v = state.aisVessels[ctx];
    v.lastSeen = Date.now();
    switch (path) {
      case 'navigation.position':
        v.lat = value?.latitude;
        v.lon = value?.longitude;
        break;
      case 'navigation.courseOverGroundTrue':
        v.cog = value != null ? (value * 180 / Math.PI + 360) % 360 : null;
        break;
      case 'navigation.speedOverGround':
        v.sog = value != null ? value * 1.94384 : null;
        break;
      case 'name':
        v.name = value;
        break;
    }
  }

  // Prune AIS vessels not seen for 10 minutes
  setInterval(() => {
    const cutoff = Date.now() - 600000;
    let pruned = false;
    Object.keys(state.aisVessels).forEach(ctx => {
      if ((state.aisVessels[ctx].lastSeen ?? 0) < cutoff) {
        delete state.aisVessels[ctx];
        pruned = true;
      }
    });
    if (pruned) emit('ais:update', state.aisVessels);
  }, 60000);

  // ── WEBSOCKET ─────────────────────────────────────────────
  let ws = null;
  let wsRetryTimer = null;
  let wsRetryDelay = 2000;

  function wsConnect() {
    if (ws && ws.readyState <= 1) return; // already open/connecting

    const url = `ws://${SK_HOST}:${SK_WS_PORT}/signalk/v1/stream?subscribe=none`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('SBSData: SignalK connected');
      state.connected = true;
      wsRetryDelay = 2000;
      emit('connected');

      // Subscribe to own vessel instrument paths
      ws.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: SK_PATHS.map(path => ({
          path,
          period:    1000,
          policy:    'ideal',
          minPeriod: 200,
        }))
      }));

      // Subscribe to AIS vessel positions on same connection
      ws.send(JSON.stringify({
        context: 'vessels.*',
        subscribe: [
          { path: 'navigation.position',            period: 3000, policy: 'ideal' },
          { path: 'navigation.courseOverGroundTrue', period: 3000 },
          { path: 'navigation.speedOverGround',      period: 3000 },
          { path: 'name',                            period: 30000 },
        ]
      }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (!msg.updates) return;

        const ctx = msg.context ?? 'vessels.self';
        const isSelf = !ctx || ctx === 'vessels.self' || (selfContext && ctx === selfContext);

        msg.updates.forEach(update => {
          (update.values || []).forEach(({path, value}) => {
            if (isSelf) {
              applyValue(path, value);
            } else {
              applyAisValue(ctx, path, value);
            }
          });
        });

        state.lastUpdate = Date.now();
        enrichPassageWaypoints();
        emit('update', state);
        if (!isSelf) emit('ais:update', state.aisVessels);
        checkPassageAlerts();

      } catch(e) {
        console.warn('SBSData: parse error', e);
      }
    };

    ws.onclose = () => {
      state.connected = false;
      emit('disconnected');
      wsRetryTimer = setTimeout(() => {
        wsRetryDelay = Math.min(wsRetryDelay * 1.5, 30000);
        wsConnect();
      }, wsRetryDelay);
    };

    ws.onerror = (e) => {
      console.warn('SBSData: WebSocket error', e);
      ws.close();
    };
  }

  // ── RELAY API ─────────────────────────────────────────────
  async function fetchRelayStates() {
    try {
      const res = await fetch(`http://${SK_HOST}:${RELAY_PORT}/relay/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.channels) {
        data.channels.forEach(ch => {
          state.relays[ch.channel] = ch.state;
        });
        emit('relays', state.relays);
      }
    } catch(e) {
      // relay server not reachable — handled by status dots
    }
  }

  async function toggleRelay(channel, newState) {
    try {
      const res = await fetch(`http://${SK_HOST}:${RELAY_PORT}/relay/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      if (!res.ok) throw new Error('relay toggle failed');
      state.relays[channel] = newState;
      emit('relays', state.relays);
      return true;
    } catch(e) {
      console.warn('SBSData: relay toggle error', e);
      return false;
    }
  }

  // ── PASSAGE PLANNING ──────────────────────────────────────
  function setPassage(plan) {
    state.passage = {
      active:      true,
      waypoints:   plan.waypoints || [],
      nextWPIndex: 0,
      alerts:      [],
      planSOG:     plan.planSOG || null,
      planETA:     plan.planETA || null,
    };
    emit('passage:updated', state.passage);
  }

  function clearPassage() {
    state.passage.active = false;
    state.passage.alerts = [];
    emit('passage:updated', state.passage);
  }

  function advanceWaypoint() {
    if (state.passage.nextWPIndex < state.passage.waypoints.length - 1) {
      state.passage.nextWPIndex++;
      emit('passage:updated', state.passage);
    }
  }

  // ── WAYPOINT ENRICHMENT ────────────────────────────────────
  function haversineNm(la1, lo1, la2, lo2) {
    const R = 3440.065, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function bearingDeg(la1, lo1, la2, lo2) {
    const dLo = (lo2 - lo1) * Math.PI / 180;
    const lat1 = la1 * Math.PI / 180, lat2 = la2 * Math.PI / 180;
    const x = Math.sin(dLo) * Math.cos(lat2);
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLo);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }
  function enrichPassageWaypoints() {
    if (!state.passage.active || !state.position || !state.passage.waypoints.length) return;
    const pos = state.position;
    const idx = state.passage.nextWPIndex;
    if (idx >= state.passage.waypoints.length) return;
    const wp = state.passage.waypoints[idx];
    if (!wp.lat || !wp.lon) return;
    wp.distance = haversineNm(pos.latitude, pos.longitude, wp.lat, wp.lon);
    wp.bearing  = bearingDeg(pos.latitude, pos.longitude, wp.lat, wp.lon);
  }

  // ── ALERT CHECKS ──────────────────────────────────────────
  function checkPassageAlerts() {
    if (!state.passage.active) return;

    // SOG advisory — if significantly below planned SOG
    if (state.passage.planSOG && state.sog != null) {
      if (state.sog < state.passage.planSOG * 0.7) {
        raiseAdvisory('sog_low',
          `SOG ${fmt(state.sog, 1)}kn — below planned ${fmt(state.passage.planSOG, 1)}kn`);
      } else {
        clearAdvisory('sog_low');
      }
    }
  }

  function raiseUrgent(id, message) {
    const existing = state.passage.alerts.find(a => a.id === id);
    if (!existing) {
      const alert = { id, level: 'urgent', message, time: Date.now() };
      state.passage.alerts.push(alert);
      emit('alert:urgent', alert);
    }
  }

  function raiseAdvisory(id, message) {
    const existing = state.passage.alerts.find(a => a.id === id);
    if (!existing) {
      const alert = { id, level: 'advisory', message, time: Date.now() };
      state.passage.alerts.push(alert);
      emit('alert:advisory', alert);
      emit('update', state); // trigger badge update
    }
  }

  function clearAdvisory(id) {
    const before = state.passage.alerts.length;
    state.passage.alerts = state.passage.alerts.filter(a => a.id !== id);
    if (state.passage.alerts.length !== before) emit('update', state);
  }

  function dismissAlert(id) {
    state.passage.alerts = state.passage.alerts.filter(a => a.id !== id);
    emit('update', state);
  }

  // External bilge alert (can be raised from relay server polling)
  function raiseBilgeAlert() {
    raiseUrgent('bilge', '⚠ BILGE WATER DETECTED — check bilge pump');
  }

  // ── DISPLAY HELPERS ───────────────────────────────────────
  function fmt(val, decimals = 0, fallback = '---') {
    if (val == null || isNaN(val)) return fallback;
    return val.toFixed(decimals);
  }

  function fmtBearing(deg, fallback = '---') {
    if (deg == null) return fallback;
    return Math.round(deg).toString().padStart(3, '0') + '°';
  }

  function fmtCoord(lat, lon) {
    if (lat == null || lon == null) return '--- ---';
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const latDeg = Math.abs(lat);
    const lonDeg = Math.abs(lon);
    const latMin = (latDeg % 1) * 60;
    const lonMin = (lonDeg % 1) * 60;
    return `${Math.floor(latDeg)}°${latMin.toFixed(3)}'${latDir} ` +
           `${Math.floor(lonDeg)}°${lonMin.toFixed(3)}'${lonDir}`;
  }

  // ── POLL INTERVALS ────────────────────────────────────────
  // Relay state and system status poll (less frequent — REST)
  setInterval(fetchRelayStates, 5000);

  // Connection watchdog — if no update in 10s, flag stale
  setInterval(() => {
    if (state.lastUpdate && Date.now() - state.lastUpdate > 10000) {
      emit('stale');
    }
  }, 5000);

  // ── NIGHT MODE ────────────────────────────────────────────
  let nightMode = false;
  function toggleNight() {
    nightMode = !nightMode;
    document.documentElement.classList.toggle('night', nightMode);
    localStorage.setItem('sbs-night', nightMode ? '1' : '0');
    emit('night', nightMode);
    return nightMode;
  }

  // Restore night mode preference
  if (localStorage.getItem('sbs-night') === '1') toggleNight();

  // ── UTC CLOCK ─────────────────────────────────────────────
  function updateClock() {
    const el = document.querySelector('.sbs-clock');
    if (el) {
      const now = new Date();
      el.textContent = now.toUTCString().slice(17, 22) + ' UTC';
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── INIT ──────────────────────────────────────────────────
  function init() {
    wsConnect();
    fetchRelayStates();
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { fetchSelfContext(); init(); });
  } else {
    fetchSelfContext();
    init();
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    // State (read-only reference — do not mutate directly)
    get sog()      { return state.sog; },
    get cog()      { return state.cog; },
    get heading()  { return state.heading; },
    get depth()    { return state.depth; },
    get tws()      { return state.tws; },
    get twd()      { return state.twd; },
    get aws()      { return state.aws; },
    get awa()      { return state.awa; },
    get pressure() { return state.pressure; },
    get temp()     { return state.temp; },
    get humidity() { return state.humidity; },
    get stw()      { return state.stw; },
    get bilge()    { return state.bilge; },
    get position() { return state.position; },
    get relays()   { return state.relays; },
    get passage()     { return state.passage; },
    get aisVessels()  { return state.aisVessels; },
    get connected(){  return state.connected; },
    get gpsValid() { return state.gpsValid; },
    get nightMode(){ return nightMode; },

    // Events
    on, off,

    // Actions
    toggleRelay,
    setPassage,
    clearPassage,
    advanceWaypoint,
    dismissAlert,
    raiseBilgeAlert,
    raiseUrgent,
    toggleNight,

    // Formatting helpers
    fmt,
    fmtBearing,
    fmtCoord,

    // Internal (for debugging)
    _state: state,
    _reconnect: wsConnect,
    get _selfContext() { return selfContext; },
  };
})();
