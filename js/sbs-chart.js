/* ============================================================
   SBS-CHART.JS — Charts tab: Leaflet map, SignalK tiles,
   boat position, AIS vessels, helm-display style overlays
   ============================================================ */

const SBSChart = (() => {
  const SK_HOST = window.location.hostname || '192.168.8.201';
  const SK_PORT = 3000;
  const SK_BASE = `http://${SK_HOST}:${SK_PORT}`;
  const CHARTS_API = `${SK_BASE}/signalk/v1/api/resources/charts`;

  let map = null;
  let boatMarker = null;
  let boatIcon = null;
  let aisLayer = null;
  let waypointsLayer = null;
  let weatherLayer = null;
  let weatherOn = false;
  let velocityLayer = null;
  let gribOn = false;
  let initialized = false;
  let windArrowEl = null;

  // ── TILE SOURCES ────────────────────────────────────────────
  // Base chart sources — cycled with the chart-base-btn.
  //
  // ESRI Ocean:  reliable default, works on all networks (boat hotspot).
  // LOCAL ENC:   offline NOAA S-57 charts rendered by MapServer on the Pi —
  //              full depth contours, hazards, aids to nav from downloaded ENCs.
  //              Uses localChartPane (no CSS filter) to preserve chart colours.
  // NOAA online: official NOAA RNC tile CDN — best when device has direct internet.
  //              Sometimes blocked by carrier-grade NAT/boat router.
  // SignalK charts prepended by loadSignalKCharts() when plugin has MBTiles data.
  const LOCAL_WMS_LAYERS = [
    'DEPARE_verydeep', 'DEPARE_deep', 'DEPARE_mid',
    'DEPARE_shallow', 'DEPARE_vshallow', 'DEPARE_drying', 'DEPARE_neg',
    'SBDARE', 'LNDARE', 'DRGARE',
    'DEPCNT', 'COALNE', 'SLCONS',
    'WRECKS', 'OBSTRN', 'UWTROC',
    'SOUNDG',
  ].join(',');

  const BASE_SRCS = [
    {
      key: 'local',
      label: 'LOCAL',
      // MapServer WMS serving local NOAA S-57 ENCs from /data/charts/noaa_enc
      // Uses localChartPane (no colour-shift filter) to preserve chart symbology
      create: () => L.tileLayer.wms(
        `http://${SK_HOST}/cgi-bin/mapserv`,
        { layers: LOCAL_WMS_LAYERS, styles: '', format: 'image/png',
          // transparent: true so ESRI ocean shows through areas without ENC coverage
          transparent: true, version: '1.1.1',
          attribution: 'Charts: <a href="https://nauticalcharts.noaa.gov">NOAA OCS</a>',
          pane: 'localChartPane' }
      ),
    },
    {
      key: 'esri',
      label: 'ESRI',
      create: () => L.tileLayer(
        // ArcGIS REST tile path uses {z}/{y}/{x} (row before column)
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, National Geographic',
          maxNativeZoom: 13, maxZoom: 18, pane: 'baseTilePane' }
      ),
    },
    {
      key: 'noaa',
      label: 'NOAA',
      create: () => L.tileLayer(
        'https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png',
        { attribution: '<a href="https://nauticalcharts.noaa.gov">NOAA Office of Coast Survey</a>',
          maxNativeZoom: 16, maxZoom: 18, pane: 'baseTilePane' }
      ),
    },
  ];
  let baseIdx = 0; // 0 = LOCAL (NOAA ENCs), 1 = ESRI, 2 = NOAA online
  let baseLayer = null;
  let esriUnderlay = null; // Always-on ESRI base when LOCAL is active

  // OpenSeaMap overlay — buoys, lights, hazards, anchorages (goes on top of base)
  const OPENSEAMAP_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
  const OPENSEAMAP_OPTS = {
    attribution: '&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>',
    maxZoom: 18,
    opacity: 0.85,
    pane: 'seamarkPane',
  };

  function setupMapPanes() {
    // Base tile pane — darkened nautical filter for ESRI/NOAA online tiles
    map.createPane('baseTilePane');
    map.getPane('baseTilePane').style.zIndex = 200;
    map.getPane('baseTilePane').style.filter =
      'brightness(0.72) saturate(0.80) hue-rotate(195deg)';

    // Local chart pane — MapServer-rendered ENCs, no filter (colours are pre-set)
    map.createPane('localChartPane');
    map.getPane('localChartPane').style.zIndex = 202;

    // Seamark pane — OpenSeaMap sits above base, no filter so symbols stay crisp
    map.createPane('seamarkPane');
    map.getPane('seamarkPane').style.zIndex = 250;
  }

  function setBaseLayer(idx) {
    if (baseLayer) { baseLayer.remove(); baseLayer = null; }
    if (esriUnderlay) { esriUnderlay.remove(); esriUnderlay = null; }
    baseIdx = ((idx % BASE_SRCS.length) + BASE_SRCS.length) % BASE_SRCS.length;
    const src = BASE_SRCS[baseIdx];

    // LOCAL mode: put ESRI underneath first so ocean shows through transparent chart tiles
    if (src.key === 'local') {
      const esriSrc = BASE_SRCS.find(b => b.key === 'esri');
      if (esriSrc) esriUnderlay = esriSrc.create().addTo(map);
    }

    baseLayer = src.create
      ? src.create().addTo(map)
      : L.tileLayer(src.url, src.opts).addTo(map);
    const btn = document.getElementById('chart-base-btn');
    if (btn) btn.textContent = src.label;
  }

  function addBaseAndSeamarks() {
    setBaseLayer(baseIdx);
    L.tileLayer(OPENSEAMAP_URL, OPENSEAMAP_OPTS).addTo(map);
  }

  function cycleBaseLayer() {
    if (!map) return;
    setBaseLayer(baseIdx + 1);
  }

  function afterMapReady() {
    centerOnBoat();
    initBoatMarker();
    initAisLayer();
    initWaypointsLayer();
    // Use shared SBSData connection for AIS instead of a second WebSocket
    SBSData.on('ais:update', renderAisMarkers);
    initialized = true;
    setTimeout(() => { map.invalidateSize(); }, 100);
    window.addEventListener('resize', () => { map.invalidateSize(); });
  }

  function init() {
    if (initialized) return;
    const wrap = document.getElementById('chart-map-wrap');
    const mapEl = document.getElementById('chart-map');
    if (!wrap || !mapEl) return;

    map = L.map('chart-map', {
      center: [47.6062, -122.3321],
      zoom: 11,
      zoomControl: false,
      preferCanvas: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    setupMapPanes();

    // Try SignalK charts plugin first (downloaded ENCs served via SK)
    // If found they go to the front of BASE_SRCS; always fall back to NOAA tiles then ESRI
    loadSignalKCharts().catch(() => false).then(() => {
      addBaseAndSeamarks();
      afterMapReady();
    });

    windArrowEl = document.getElementById('chart-wind-arrow');
  }

  async function loadSignalKCharts() {
    const res = await fetch(CHARTS_API);
    if (!res.ok) return false;
    const data = await res.json();

    // SignalK charts API returns an object keyed by chart identifier, not an array
    const entries = (typeof data === 'object' && !Array.isArray(data))
      ? Object.values(data)
      : (Array.isArray(data) ? data : []);
    if (entries.length === 0) return false;

    // Add all SK chart sources to the front of BASE_SRCS so they show up first in cycle
    let addedCount = 0;
    [...entries].reverse().forEach(chart => {
      const id = chart?.identifier ?? chart?.id;
      const name = chart?.name ?? id;
      const tileUrl = chart?.tilemapUrl
        ?? (id ? `${SK_BASE}/signalk/v1/api/resources/charts/${id}/{z}/{x}/{y}` : null);
      if (!tileUrl) return;
      const existing = BASE_SRCS.findIndex(b => b.key === `sk:${id}`);
      const _url = tileUrl, _name = name;
      const entry = {
        key: `sk:${id}`,
        label: 'SK',
        title: name,
        create: () => L.tileLayer(_url, { maxZoom: 18, pane: 'baseTilePane', attribution: `Chart: ${_name}` }),
      };
      if (existing >= 0) BASE_SRCS[existing] = entry;
      else BASE_SRCS.unshift(entry);
      addedCount++;
    });

    if (addedCount === 0) return false;
    baseIdx = 0; // start on first SK chart
    return true;
  }

  function initBoatMarker() {
    boatIcon = L.divIcon({
      className: 'chart-boat-marker',
      html: '<div class="chart-boat-arrow"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const center = map.getCenter();
    boatMarker = L.marker([center.lat, center.lng], { icon: boatIcon, zIndexOffset: 1000 }).addTo(map);
  }

  function initAisLayer() {
    aisLayer = L.layerGroup().addTo(map);
  }

  function initWaypointsLayer() {
    waypointsLayer = L.layerGroup().addTo(map);
  }

  function renderAisMarkers() {
    if (!aisLayer) return;
    aisLayer.clearLayers();
    const vessels = SBSData?.aisVessels ?? {};
    Object.entries(vessels).forEach(([ctx, v]) => {
      if (v.lat == null || v.lon == null) return;
      const icon = L.divIcon({
        className: 'chart-ais-marker',
        html: `<div class="chart-ais-triangle" style="transform:rotate(${v.cog ?? 0}deg)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const m = L.marker([v.lat, v.lon], { icon }).addTo(aisLayer);
      const id = ctx.split(':').pop(); // last segment of URN as display ID
      const parts = [v.name ?? id, v.sog != null ? v.sog.toFixed(1) + ' kt' : null, v.cog != null ? v.cog.toFixed(0) + '°' : null].filter(Boolean);
      m.bindPopup(parts.join(' · '));
    });
  }

  function updateBoat() {
    const pos = SBSData?.position ?? SBSData?._state?.position;
    const cog = SBSData?.cog ?? SBSData?._state?.cog ?? 0;
    if (!boatMarker) return;
    if (pos?.latitude != null && pos?.longitude != null) {
      boatMarker.setLatLng([pos.latitude, pos.longitude]);
      const arrow = boatMarker.getElement()?.querySelector('.chart-boat-arrow');
      if (arrow) arrow.style.transform = `rotate(${cog}deg)`;
    }
  }

  function updateWaypoints() {
    if (!waypointsLayer) return;
    waypointsLayer.clearLayers();
    const wp = (SBSData?.passage ?? SBSData?._state?.passage)?.waypoints ?? [];
    if (wp.length < 2) return;
    const latlngs = wp.map(p => [p.lat ?? p.latitude, p.lon ?? p.longitude]).filter(([a, b]) => a != null && b != null);
    if (latlngs.length < 2) return;
    L.polyline(latlngs, { color: 'var(--c-amber)', weight: 2, dashArray: '7,5', opacity: 0.8 }).addTo(waypointsLayer);
    wp.forEach((p, i) => {
      const lat = p.lat ?? p.latitude, lon = p.lon ?? p.longitude;
      if (lat == null || lon == null) return;
      L.circleMarker([lat, lon], { radius: 5, color: 'var(--c-amber)', fillColor: 'var(--c-amber)', fillOpacity: 0.3, weight: 1.5 })
        .bindPopup(p.name ?? `WP${i + 1}`)
        .addTo(waypointsLayer);
    });
  }

  function updateOverlays() {
    if (!map) return;
    const d = SBSData ?? (typeof SBSData !== 'undefined' ? SBSData : null);
    if (!d) return;
    const fmt = d.fmt ? d.fmt.bind(d) : (v, dec) => (v != null ? (typeof dec === 'number' ? v.toFixed(dec) : String(v)) : '--');
    const fmtB = d.fmtBearing ? d.fmtBearing.bind(d) : (v) => (v != null ? Math.round(v) + '°' : '---°');

    const cog = d.cog ?? d._state?.cog;
    const sog = d.sog ?? d._state?.sog;
    const tws = d.tws ?? d._state?.tws;
    const twd = d.twd ?? d._state?.twd;
    const depth = d.depth ?? d._state?.depth;
    const pressure = d.pressure ?? d._state?.pressure;

    const p = d.passage ?? d._state?.passage;
    const nextWp = p?.waypoints?.[p.nextWPIndex ?? 0];
    const btw = nextWp?.bearing ?? null;
    const dtw = nextWp?.distance ?? null;

    setText('chart-cog', fmtB(cog));
    setText('chart-sog', sog != null ? fmt(sog, 1) + (document.querySelector('#chart-sog .chart-ndc-unit') ? '' : '') : '--.-');
    setText('chart-btw', fmtB(btw));
    setText('chart-dtw', dtw != null ? fmt(dtw, 1) : '--.-');

    setText('chart-tws', tws != null ? fmt(tws, 1) : '--');
    setText('chart-twd', twd != null ? fmtB(twd) : '---°');
    setText('chart-depth', depth != null ? fmt(depth, 1) : '--.-');
    setText('chart-baro', pressure != null ? fmt(pressure, 0) : '---');

    const windVal = document.getElementById('chart-wind-val');
    if (windVal) windVal.textContent = tws != null ? fmt(tws, 0) + 'kt' : '--kt';

    if (windArrowEl && twd != null) {
      windArrowEl.setAttribute('transform', `translate(42,42) rotate(${twd})`);
    }

    updateBoat();
    updateWaypoints();
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'chart-sog') {
      const unit = el.querySelector('.chart-ndc-unit');
      el.innerHTML = (val ?? '--.-') + (unit ? unit.outerHTML : '<span class="chart-ndc-unit">kt</span>');
    } else if (id === 'chart-dtw') {
      const unit = el.querySelector('.chart-ndc-unit');
      el.innerHTML = (val ?? '--.-') + (unit ? unit.outerHTML : '<span class="chart-ndc-unit">nm</span>');
    } else {
      el.textContent = val ?? '--';
    }
  }

  // ── WEATHER OVERLAY ────────────────────────────────────────
  // OWM tile layers (best with free API key from openweathermap.org)
  // RainViewer used as no-key fallback for precipitation radar.
  const WX_MAX_RADAR_ZOOM = 8;  // radar data resolution limit
  const OWM_LS_KEY = 'sbs-owm-apikey';
  const OWM_LAYERS = [
    { id: 'wind_new',          label: 'WIND',  zoom: 18 },
    { id: 'precipitation_new', label: 'RAIN',  zoom: 18 },
    { id: 'pressure_new',      label: 'PRES',  zoom: 18 },
    { id: 'clouds_new',        label: 'CLDS',  zoom: 18 },
  ];
  let wxLayerIdx = 0;

  function getOWMKey() { return localStorage.getItem(OWM_LS_KEY) || null; }
  function setOWMKey(k) { if (k) localStorage.setItem(OWM_LS_KEY, k.trim()); }

  async function loadWeatherLayer() {
    if (weatherLayer) { weatherLayer.remove(); weatherLayer = null; }
    const owmKey = getOWMKey();

    if (owmKey) {
      const layer = OWM_LAYERS[wxLayerIdx];
      weatherLayer = L.tileLayer(
        `https://tile.openweathermap.org/map/${layer.id}/{z}/{x}/{y}.png?appid=${owmKey}`,
        { opacity: 0.65, attribution: 'Weather © OpenWeatherMap', pane: 'seamarkPane', zIndex: 260, maxZoom: 18 }
      );
      weatherLayer.addTo(map);
      updateWxPicker();
    } else {
      // RainViewer fallback — free, worldwide precipitation radar
      // Zoom range 5-8 only (radar data resolution ~1 km)
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) throw new Error('no data');
        const data = await res.json();
        const frames = data?.radar?.past ?? [];
        if (!frames.length) throw new Error('no frames');
        const latest = frames[frames.length - 1];
        // Use host from response, 256px tiles (no zoomOffset needed)
        weatherLayer = L.tileLayer(
          `${data.host}${latest.path}/256/{z}/{x}/{y}/4/1_1.png`,
          { opacity: 0.60, attribution: 'Radar © RainViewer', pane: 'seamarkPane',
            zIndex: 260, maxNativeZoom: WX_MAX_RADAR_ZOOM, maxZoom: 18 }
        );
        weatherLayer.addTo(map);
        if (map.getZoom() > WX_MAX_RADAR_ZOOM) {
          map.flyTo(map.getCenter(), WX_MAX_RADAR_ZOOM, { duration: 0.6 });
        }
      } catch (e) {
        console.warn('SBSChart: weather overlay failed', e);
        weatherOn = false;
        const btn = document.getElementById('chart-wx-btn');
        if (btn) { btn.classList.remove('active'); btn.title = 'Radar unavailable'; }
      }
    }
  }

  function updateWxPicker() {
    const picker = document.getElementById('chart-wx-picker');
    if (!picker) return;
    const owmKey = getOWMKey();
    // Always show picker when weather is on — key button must be reachable
    picker.style.display = weatherOn ? 'flex' : 'none';
    // Highlight active layer button only when key is set
    picker.querySelectorAll('.chart-wxl:not(.chart-wxl-key)').forEach((btn, i) => {
      btn.style.display = owmKey ? '' : 'none';
      btn.classList.toggle('active', i === wxLayerIdx);
    });
    // Update key button label to show status
    const keyBtn = picker.querySelector('.chart-wxl-key');
    if (keyBtn) keyBtn.title = owmKey ? 'Change OWM API key' : 'Set OWM API key (required for wind/rain/pressure layers)';
  }

  function selectWxLayer(idx) {
    wxLayerIdx = idx;
    if (weatherOn) loadWeatherLayer();
    updateWxPicker();
  }

  function setWeatherApiKey() {
    const existing = getOWMKey() || '';
    const key = window.prompt('OpenWeatherMap API key\n(free at openweathermap.org → API keys):', existing);
    if (key !== null) {
      setOWMKey(key);
      if (weatherOn) loadWeatherLayer();
    }
  }

  function toggleWeather() {
    if (!map) return;
    weatherOn = !weatherOn;
    const btn = document.getElementById('chart-wx-btn');
    const picker = document.getElementById('chart-wx-picker');
    if (weatherOn) {
      if (btn) btn.classList.add('active');
      loadWeatherLayer();
      updateWxPicker();
    } else {
      if (btn) btn.classList.remove('active');
      if (weatherLayer) { weatherLayer.remove(); weatherLayer = null; }
      updateWxPicker();
    }
  }

  // ── GRIB WIND LAYER (leaflet-velocity / NOAA GFS) ──────────
  async function loadGribLayer() {
    if (velocityLayer) { velocityLayer.remove(); velocityLayer = null; }
    if (typeof L.velocityLayer === 'undefined') {
      console.warn('SBSChart: leaflet-velocity not loaded');
      return;
    }
    const btn = document.getElementById('chart-grib-btn');
    if (btn) btn.textContent = '⌛';

    const bounds = map.getBounds();
    const pad = 1.5;
    const params = new URLSearchParams({
      lat1: Math.floor(bounds.getSouth() - pad),
      lon1: Math.floor(bounds.getWest()  - pad),
      lat2: Math.ceil( bounds.getNorth() + pad),
      lon2: Math.ceil( bounds.getEast()  + pad),
    });

    try {
      const res = await fetch(`http://${SK_HOST}:5000/api/wind-grid?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      velocityLayer = L.velocityLayer({
        displayValues: true,
        displayOptions: {
          velocityType: 'GFS Wind',
          position: 'bottomleft',
          emptyString: 'No GFS data',
          angleConvention: 'bearingCCW',
          speedUnit: 'kt',
        },
        data,
        maxVelocity: 40,
        velocityScale: 0.007,
        colorScale: ['#00d4ff','#00ffaa','#aaff00','#ffcc00','#ff6600','#ff0000'],
        opacity: 0.85,
      });
      velocityLayer.addTo(map);

      const refTime = data[0]?.header?.refTime;
      if (btn) {
        btn.textContent = '🌬';
        btn.title = refTime
          ? `GFS Wind — valid ${refTime.slice(0, 16)} UTC`
          : 'GFS Wind (NOAA)';
      }
    } catch (e) {
      console.warn('SBSChart: GRIB layer failed:', e);
      gribOn = false;
      if (btn) { btn.textContent = '🌬'; btn.classList.remove('active'); btn.title = `GFS unavailable: ${e.message}`; }
    }
  }

  function toggleGrib() {
    if (!map) return;
    gribOn = !gribOn;
    const btn = document.getElementById('chart-grib-btn');
    if (gribOn) {
      if (btn) btn.classList.add('active');
      loadGribLayer();
    } else {
      if (btn) { btn.classList.remove('active'); btn.textContent = '🌬'; }
      if (velocityLayer) { velocityLayer.remove(); velocityLayer = null; }
    }
  }

  // ── CENTER ON BOAT ─────────────────────────────────────────
  let _followBoat = false;

  function centerOnBoat() {
    const pos = SBSData?.position;
    if (!map) return;
    if (pos?.latitude != null && pos?.longitude != null) {
      map.setView([pos.latitude, pos.longitude], Math.max(map.getZoom(), 12));
    }
  }

  // ── MOB MARKER ─────────────────────────────────────────────
  let mobMarker = null;

  function triggerMOB() {
    if (typeof SBSData?.raiseUrgent === 'function') {
      SBSData.raiseUrgent('mob', '⚠ MAN OVERBOARD — recovery in progress');
    }
    const pos = SBSData?.position;
    if (map && pos?.latitude != null && pos?.longitude != null) {
      if (mobMarker) mobMarker.remove();
      const icon = L.divIcon({
        className: 'chart-mob-marker',
        html: '<div class="chart-mob-ring"><div class="chart-mob-dot"></div></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      mobMarker = L.marker([pos.latitude, pos.longitude], { icon, zIndexOffset: 2000 })
        .bindPopup(`<b>⚠ MOB</b><br>${SBSData.fmtCoord(pos.latitude, pos.longitude)}<br>${new Date().toUTCString().slice(17, 22)} UTC`)
        .addTo(map);
      mobMarker.openPopup();
      map.setView([pos.latitude, pos.longitude], Math.max(map.getZoom(), 14));
    }
  }

  function clearMOB() {
    if (mobMarker) { mobMarker.remove(); mobMarker = null; }
  }

  function ensureInit() {
    if (!initialized) init();
  }

  return {
    init: ensureInit,
    update: updateOverlays,
    centerOnBoat,
    cycleBaseLayer,
    toggleWeather,
    selectWxLayer,
    setWeatherApiKey,
    toggleGrib,
    triggerMOB,
    clearMOB,
    invalidateSize: () => { if (map) map.invalidateSize(); },
  };
})();

// Called from onclick in HTML
function triggerChartMOB() {
  SBSChart.triggerMOB();
}
