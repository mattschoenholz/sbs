/* ============================================================
   SBS-CHART-MAPLIBRE.JS — Shared MapLibre GL chart module
   Used by portal (index.html) and helm (helm.html).

   Usage:
     SBSChartML.init({ containerId: 'chart-map', statusId: 'status' });
     SBSChartML.centerOnBoat();
     SBSChartML.invalidateSize();   // call when tab becomes visible
   ============================================================ */

const SBSChartML = (() => {

  // ── Config ──────────────────────────────────────────────────
  const ENC_FILE_URL = `${window.location.origin}/charts/enc.pmtiles`;
  const ESRI_OCEAN   = 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';
  const ESRI_LABELS  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}';
  const SK_POSITION  = `/signalk/v1/api/vessels/self/navigation/position`;

  const NM_TO_DEG = 1 / 60;
  const PREWARM_ZOOMS_NEAR = [8, 9, 10, 11, 12, 13];
  const PREWARM_ZOOMS_FAR  = [8, 9, 10, 11];

  let _map = null;
  let _boatMarker = null;
  let _statusEl = null;
  let _initialized = false;
  let _boatLngLat = null;

  // ── Depth icon ───────────────────────────────────────────────
  function makeDepthImage(depthStr, dpr) {
    const metres = parseFloat(depthStr);
    const feet = Math.round(metres * 3.28084);
    const label = isNaN(feet) ? depthStr : String(feet);
    const W = 28, H = 16, scale = dpr || 1;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
    ctx.strokeText(label, W / 2, H / 2);
    ctx.fillStyle = '#4a6a8a';
    ctx.fillText(label, W / 2, H / 2);
    return { width: W * scale, height: H * scale,
      data: new Uint8Array(ctx.getImageData(0, 0, W * scale, H * scale).data.buffer) };
  }

  // ── Tile math for pre-warm ───────────────────────────────────
  function lngLatToTile(lng, lat, z) {
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latR = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
    return { x, y, z };
  }

  function tilesInBbox(sw, ne, z) {
    const t0 = lngLatToTile(sw[0], ne[1], z);
    const t1 = lngLatToTile(ne[0], sw[1], z);
    const tiles = [];
    for (let x = t0.x; x <= t1.x; x++)
      for (let y = t0.y; y <= t1.y; y++)
        tiles.push({ x, y, z });
    return tiles;
  }

  function setStatus(msg) {
    if (!_statusEl) return;
    if (msg) { _statusEl.style.display = 'block'; _statusEl.textContent = msg; }
    else { _statusEl.style.display = 'none'; }
  }

  async function prewarmEsri(lat, lng, radiusNm, zooms) {
    const dLat = radiusNm * NM_TO_DEG;
    const dLng = dLat / Math.cos(lat * Math.PI / 180);
    const sw = [lng - dLng, lat - dLat];
    const ne = [lng + dLng, lat + dLat];
    const layers = ['Ocean/World_Ocean_Base', 'Ocean/World_Ocean_Reference'];
    let total = 0, done = 0;
    for (const z of zooms) total += tilesInBbox(sw, ne, z).length * layers.length;

    for (const layer of layers) {
      for (const z of zooms) {
        for (const { x, y } of tilesInBbox(sw, ne, z)) {
          fetch(`/tiles-esri/${layer}/${z}/${y}/${x}`, { priority: 'low' })
            .catch(() => {})
            .finally(() => {
              done++;
              if (done % 20 === 0)
                setStatus(`Warming tiles… ${done}/${total}`);
              if (done === total) {
                setStatus(`Tile cache warm (${total} tiles)`);
                setTimeout(() => setStatus(null), 3000);
              }
            });
          if (done % 8 === 0) await new Promise(r => setTimeout(r, 50));
        }
      }
    }
  }

  async function fetchAndCenterBoat() {
    try {
      const res = await fetch(SK_POSITION, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const d = await res.json();
      const lat = d.value?.latitude;
      const lng = d.value?.longitude;
      if (!lat || !lng) return null;
      _boatLngLat = [lng, lat];

      if (_boatMarker) _boatMarker.setLngLat([lng, lat]);
      else {
        _boatMarker = new maplibregl.Marker({ color: '#e8940a', scale: 0.85 })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML('<strong>Vessel</strong>'))
          .addTo(_map);
      }
      _map.flyTo({ center: [lng, lat], zoom: _map.getZoom(), duration: 1000 });
      return { lat, lng };
    } catch (e) { return null; }
  }

  // ── Map style (shared layer stack) ──────────────────────────
  function buildStyle() {
    const ENC_URL = `pmtiles://${ENC_FILE_URL}`;
    return {
      version: 8,
      sources: {
        esri:   { type: 'raster', tiles: [ESRI_OCEAN], tileSize: 256, maxzoom: 17, attribution: 'Esri, NOAA' },
        enc:    { type: 'vector', url: ENC_URL },
        labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 13, attribution: 'Esri' }
      },
      layers: [
        { id: 'esri-base', type: 'raster', source: 'esri', paint: { 'raster-opacity': 1 } },

        // Depth areas
        { id: 'depare-deep',    type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
          filter: ['>=', ['to-number', ['get', 'DRVAL1']], 30],
          paint: { 'fill-color': '#1b5e8a', 'fill-opacity': 0.72 } },
        { id: 'depare-medium',  type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
          filter: ['all', ['>=', ['to-number', ['get', 'DRVAL1']], 10], ['<', ['to-number', ['get', 'DRVAL1']], 30]],
          paint: { 'fill-color': '#2980b9', 'fill-opacity': 0.72 } },
        { id: 'depare-shallow', type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
          filter: ['all', ['>=', ['to-number', ['get', 'DRVAL1']], 3], ['<', ['to-number', ['get', 'DRVAL1']], 10]],
          paint: { 'fill-color': '#5dade2', 'fill-opacity': 0.75 } },
        { id: 'depare-vshallow',type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
          filter: ['all', ['>=', ['to-number', ['get', 'DRVAL1']], 0], ['<', ['to-number', ['get', 'DRVAL1']], 3]],
          paint: { 'fill-color': '#aed6f1', 'fill-opacity': 0.82 } },
        { id: 'depare-drying',  type: 'fill', source: 'enc', 'source-layer': 'DEPARE',
          filter: ['<', ['to-number', ['get', 'DRVAL1']], 0],
          paint: { 'fill-color': '#d4e6b5', 'fill-opacity': 0.85 } },

        // Land — transparent (ESRI basemap shows through)
        { id: 'lndare', type: 'fill', source: 'enc', 'source-layer': 'LNDARE',
          paint: { 'fill-color': '#c8a97e', 'fill-opacity': 0 } },

        // Depth contours
        { id: 'depcnt', type: 'line', source: 'enc', 'source-layer': 'DEPCNT',
          paint: { 'line-color': '#1a5276',
                   'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.4],
                   'line-opacity': 0.7 } },

        // Coastline
        { id: 'coalne', type: 'line', source: 'enc', 'source-layer': 'COALNE',
          paint: { 'line-color': '#5d4037', 'line-width': 1.2 } },

        // Traffic separation / shipping lanes
        { id: 'tsslpt',    type: 'fill', source: 'enc', 'source-layer': 'TSSLPT',
          paint: { 'fill-color': '#7f8c8d', 'fill-opacity': 0.15 } },
        { id: 'tssron',    type: 'fill', source: 'enc', 'source-layer': 'TSSRON',
          paint: { 'fill-color': '#95a5a6', 'fill-opacity': 0.12 } },
        { id: 'fairwy',    type: 'fill', source: 'enc', 'source-layer': 'FAIRWY', minzoom: 9,
          paint: { 'fill-color': '#5d8aa8', 'fill-opacity': 0.12 } },
        { id: 'trafic-line', type: 'line', source: 'enc', 'source-layer': 'TRAFIC', minzoom: 8,
          paint: { 'line-color': '#7f8c8d', 'line-width': 1, 'line-dasharray': [4, 3], 'line-opacity': 0.7 } },

        // Special areas
        { id: 'resare', type: 'fill', source: 'enc', 'source-layer': 'RESARE', minzoom: 9,
          paint: { 'fill-color': '#e74c3c', 'fill-opacity': 0.06, 'fill-outline-color': '#e74c3c' } },
        { id: 'airare', type: 'fill', source: 'enc', 'source-layer': 'AIRARE', minzoom: 9,
          paint: { 'fill-color': '#f39c12', 'fill-opacity': 0.15, 'fill-outline-color': '#f39c12' } },
        { id: 'achare', type: 'fill', source: 'enc', 'source-layer': 'ACHARE', minzoom: 10,
          paint: { 'fill-color': '#8e44ad', 'fill-opacity': 0.10, 'fill-outline-color': '#8e44ad' } },
        { id: 'drgare', type: 'fill', source: 'enc', 'source-layer': 'DRGARE', minzoom: 10,
          paint: { 'fill-color': '#16a085', 'fill-opacity': 0.18, 'fill-outline-color': '#16a085' } },

        // Hazards
        { id: 'wrecks', type: 'circle', source: 'enc', 'source-layer': 'WRECKS', minzoom: 11,
          paint: { 'circle-color': '#e74c3c', 'circle-radius': 4, 'circle-opacity': 0.9,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },
        { id: 'obstrn', type: 'circle', source: 'enc', 'source-layer': 'OBSTRN', minzoom: 12,
          paint: { 'circle-color': '#e67e22', 'circle-radius': 3, 'circle-opacity': 0.8,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },
        { id: 'uwtroc', type: 'circle', source: 'enc', 'source-layer': 'UWTROC', minzoom: 12,
          paint: { 'circle-color': '#c0392b', 'circle-radius': 3, 'circle-opacity': 0.75,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },

        // Buoys — filter on CATLAM (scalar int), not COLOUR (array → unreliable in MVT)
        // IALA-B: CATLAM=2=port=red, CATLAM=1=starboard=green
        { id: 'boylat-port', type: 'circle', source: 'enc', 'source-layer': 'BOYLAT', minzoom: 12,
          filter: ['==', ['to-number', ['get', 'CATLAM']], 2],
          paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 1,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
        { id: 'boylat-stbd', type: 'circle', source: 'enc', 'source-layer': 'BOYLAT', minzoom: 12,
          filter: ['==', ['to-number', ['get', 'CATLAM']], 1],
          paint: { 'circle-color': '#27ae60', 'circle-radius': 5, 'circle-opacity': 1,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
        { id: 'boylat-other', type: 'circle', source: 'enc', 'source-layer': 'BOYLAT', minzoom: 12,
          filter: ['!', ['in', ['to-number', ['get', 'CATLAM']], ['literal', [1, 2]]]],
          paint: { 'circle-color': '#f1c40f', 'circle-radius': 4, 'circle-opacity': 1,
                   'circle-stroke-color': '#333', 'circle-stroke-width': 1 } },
        { id: 'boycar', type: 'circle', source: 'enc', 'source-layer': 'BOYCAR', minzoom: 12,
          paint: { 'circle-color': '#f1c40f', 'circle-radius': 5, 'circle-opacity': 1,
                   'circle-stroke-color': '#1a1a1a', 'circle-stroke-width': 1.5 } },
        { id: 'boysaw', type: 'circle', source: 'enc', 'source-layer': 'BOYSAW', minzoom: 12,
          paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 1,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
        { id: 'boyspp', type: 'circle', source: 'enc', 'source-layer': 'BOYSPP', minzoom: 12,
          paint: { 'circle-color': '#f39c12', 'circle-radius': 4, 'circle-opacity': 0.9,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },

        // Beacons
        { id: 'bcnlat', type: 'circle', source: 'enc', 'source-layer': 'BCNLAT', minzoom: 12,
          paint: { 'circle-color': '#27ae60', 'circle-radius': 4, 'circle-opacity': 1,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } },
        { id: 'bcncar', type: 'circle', source: 'enc', 'source-layer': 'BCNCAR', minzoom: 12,
          paint: { 'circle-color': '#f1c40f', 'circle-radius': 4, 'circle-opacity': 1,
                   'circle-stroke-color': '#333', 'circle-stroke-width': 1 } },
        { id: 'bcnspp', type: 'circle', source: 'enc', 'source-layer': 'BCNSPP', minzoom: 12,
          paint: { 'circle-color': '#f39c12', 'circle-radius': 3, 'circle-opacity': 0.85,
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 0.5 } },

        // Lights
        { id: 'lights', type: 'circle', source: 'enc', 'source-layer': 'LIGHTS', minzoom: 11,
          paint: {
            'circle-color': '#ffd700',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 4],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#000', 'circle-stroke-width': 0.5
          } },

        // ESRI Ocean Reference labels — fade out as ENC detail takes over at high zoom
        { id: 'esri-labels', type: 'raster', source: 'labels',
          paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'],
            7, 1.0, 10, 0.8, 12, 0.3, 13, 0.0 ] } },

        // Depth soundings — lazy canvas icons, metres→feet at render time
        { id: 'soundings', type: 'symbol', source: 'enc', 'source-layer': 'SOUNDG',
          minzoom: 10,
          layout: {
            'icon-image': ['concat', 'snd-', ['get', 'DEPTH']],
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
            'symbol-sort-key': ['to-number', ['get', 'DEPTH']]
          } }
      ]
    };
  }

  // ── Public API ───────────────────────────────────────────────

  function init(opts = {}) {
    if (_initialized) { invalidateSize(); return; }
    const containerId = opts.containerId || 'chart-map';
    const statusId    = opts.statusId || null;
    const center      = opts.center  || [-122.34, 47.62];
    const zoom        = opts.zoom    || 11;

    _statusEl = statusId ? document.getElementById(statusId) : null;

    // Register PMTiles protocol once per page load
    if (!maplibregl._sbsPmtilesRegistered) {
      const encTiles = new pmtiles.PMTiles(ENC_FILE_URL);
      const protocol = new pmtiles.Protocol();
      protocol.add(encTiles);
      maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
      maplibregl._sbsPmtilesRegistered = true;
    }

    _map = new maplibregl.Map({
      container: containerId,
      maxTileCacheSize: 800,
      fadeDuration: 0,
      transformRequest: (url, resourceType) => {
        if (resourceType === 'Tile' && url.includes('arcgisonline.com')) {
          const m = url.match(/services\/(Ocean\/\w+)\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/);
          if (m) return { url: `/tiles-esri/${m[1]}/${m[2]}/${m[3]}/${m[4]}` };
        }
      },
      style: buildStyle(),
      center, zoom,
      maxZoom: 16, minZoom: 7
    });

    _map.addControl(new maplibregl.NavigationControl(), 'top-right');
    _map.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-right');
    _map.on('error', e => console.warn('[SBSChartML]', e.sourceId, e.error?.message));

    // Lazy depth icon generation
    const dpr = window.devicePixelRatio || 1;
    _map.on('styleimagemissing', e => {
      if (!e.id.startsWith('snd-')) return;
      _map.addImage(e.id, makeDepthImage(e.id.slice(4), dpr), { pixelRatio: dpr });
    });

    _map.on('load', async () => {
      // AIS layer — cyan circles, updated via SBSData events
      _map.addSource('ais', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      _map.addLayer({
        id: 'ais-vessels', type: 'circle', source: 'ais',
        paint: {
          'circle-color': '#06b6d4',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 7],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5
        }
      });

      // Update AIS source whenever SBSData fires an ais:update event
      if (typeof SBSData !== 'undefined') {
        SBSData.on('ais:update', vessels => _updateAis(vessels));
        _updateAis(SBSData.aisVessels);  // populate immediately if data already present
      }

      setStatus('Fetching GPS position…');
      const pos = await fetchAndCenterBoat();
      const lat = pos?.lat || center[1];
      const lng = pos?.lng || center[0];
      if (!pos) setStatus('SignalK unavailable — default chart center');

      setStatus('Warming 20nm tile cache…');
      await prewarmEsri(lat, lng, 20, PREWARM_ZOOMS_NEAR);
      await prewarmEsri(lat, lng, 30, PREWARM_ZOOMS_FAR);
    });

    // AIS click popup — name + MMSI
    _map.on('click', 'ais-vessels', e => {
      const p = e.features[0].properties;
      const name = p.name || 'Unknown vessel';
      const mmsi = p.mmsi || '—';
      const sog  = p.sog != null ? parseFloat(p.sog).toFixed(1) + ' kn' : '—';
      const cog  = p.cog != null ? Math.round(parseFloat(p.cog)) + '°' : '—';
      new maplibregl.Popup({ offset: 8 })
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${name}</strong><br>MMSI: ${mmsi}<br>SOG: ${sog} &nbsp; COG: ${cog}`)
        .addTo(_map);
      e.originalEvent.stopPropagation();
    });
    _map.on('mouseenter', 'ais-vessels', () => _map.getCanvas().style.cursor = 'pointer');
    _map.on('mouseleave', 'ais-vessels', () => _map.getCanvas().style.cursor = '');

    // Sounding click popup
    _map.on('click', 'soundings', e => {
      const m = parseFloat(e.features[0].properties.DEPTH);
      const ft = Math.round(m * 3.28084);
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>Sounding</strong><br>${ft} ft (${m} m)`)
        .addTo(_map);
    });
    _map.on('mouseenter', 'soundings', () => _map.getCanvas().style.cursor = 'pointer');
    _map.on('mouseleave', 'soundings', () => _map.getCanvas().style.cursor = '');

    _initialized = true;
  }

  function _updateAis(vessels) {
    if (!_map || !_map.getSource('ais')) return;
    const features = Object.entries(vessels || {}).map(([ctx, v]) => {
      if (v.lat == null || v.lon == null) return null;
      const mmsi = ctx.match(/mmsi:(\d+)/)?.[1] || ctx.split('.').pop();
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: { name: v.name || null, mmsi, sog: v.sog, cog: v.cog }
      };
    }).filter(Boolean);
    _map.getSource('ais').setData({ type: 'FeatureCollection', features });
  }

  function centerOnBoat() {
    if (_boatLngLat) _map.flyTo({ center: _boatLngLat, zoom: 13, duration: 800 });
    else fetchAndCenterBoat();
  }

  function invalidateSize() {
    if (_map) _map.resize();
  }

  function getMap() { return _map; }

  return { init, centerOnBoat, invalidateSize, getMap };
})();
