(async () => {
  const [styleResponse, style3dResponse] = await Promise.all([
    fetch('../styles.json'),
    fetch('style.json')
  ]);
  if (!styleResponse.ok) throw new Error(`Failed to load styles.json: ${styleResponse.status}`);
  if (!style3dResponse.ok) throw new Error(`Failed to load style.json: ${style3dResponse.status}`);
  const styleDoc  = await styleResponse.json();
  const mapStyle  = await style3dResponse.json();
  const palettes  = styleDoc.metadata?.palettes || {};

  const RAWRGB_PMTILES_URL = 'https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles/resolve/main/gebco_2026_terrain_rgb.pmtiles';

  // ── Palette LUT ──────────────────────────────────────────────────────────────
  const LUT_SIZE  = 2048;
  const LUT_MIN   = -11000;
  const LUT_RANGE = 11000;

  function _clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  function _depthColorRaw(elev, stops) {
    if (!stops || stops.length === 0) return [0, 0, 0];
    if (elev <= stops[0][0]) return stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (elev <= b[0]) {
        const t = (elev - a[0]) / (b[0] - a[0]);
        return [
          _clampByte(a[1][0] + (b[1][0] - a[1][0]) * t),
          _clampByte(a[1][1] + (b[1][1] - a[1][1]) * t),
          _clampByte(a[1][2] + (b[1][2] - a[1][2]) * t),
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function buildLut(stops) {
    const lut = new Uint8Array(LUT_SIZE * 3);
    for (let i = 0; i < LUT_SIZE; i++) {
      const elev = LUT_MIN + (i / (LUT_SIZE - 1)) * LUT_RANGE;
      const [r, g, b] = _depthColorRaw(elev, stops);
      lut[i * 3]     = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    return lut;
  }

  const paletteLuts = {};
  for (const [name, pal] of Object.entries(palettes)) {
    paletteLuts[name] = buildLut(pal.stops || []);
  }

  // ── Cache & Sampling helpers ───────────────────────────────────────────────
  const pmtilesCache = new Map();
  const rawBytesCache = new Map();
  const MAX_RAW_CACHE_SIZE = 512;

  const queryCanvas = document.createElement('canvas');
  const queryCtx    = queryCanvas.getContext('2d', { willReadFrequently: true });

  function getPmtilesArchive(url) {
    if (!pmtilesCache.has(url)) pmtilesCache.set(url, new pmtiles.PMTiles(url));
    return pmtilesCache.get(url);
  }

  function lngLatToTilePixel(lng, lat, zoom) {
    const n = 1 << zoom;
    const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
    const xFloat = ((wrappedLng + 180) / 360) * n;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const latRad = clampedLat * Math.PI / 180;
    const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    let tileX = Math.floor(xFloat);
    let tileY = Math.floor(yFloat);
    tileX = ((tileX % n) + n) % n;
    tileY = Math.max(0, Math.min(n - 1, tileY));
    const pixelX = Math.max(0, Math.min(255, Math.floor((xFloat - Math.floor(xFloat)) * 256)));
    const pixelY = Math.max(0, Math.min(255, Math.floor((yFloat - Math.floor(yFloat)) * 256)));
    return { tileX, tileY, pixelX, pixelY };
  }

  async function decodeDepthAtPixel(tileBytes, pixelX, pixelY) {
    const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const bitmap = await createImageBitmap(blob);
    queryCanvas.width  = bitmap.width;
    queryCanvas.height = bitmap.height;
    queryCtx.drawImage(bitmap, 0, 0);
    const px = queryCtx.getImageData(pixelX, pixelY, 1, 1).data;
    bitmap.close();
    if (px[3] === 0) return null;
    return decodeTerrainRgbElevation(px[0], px[1], px[2]);
  }

  async function sampleDepthAtLngLat(map, lngLat) {
    const archive  = getPmtilesArchive(RAWRGB_PMTILES_URL);
    const maxZoom  = 10;
    const zoom     = Math.max(0, Math.min(maxZoom, Math.floor(map.getZoom())));
    const { tileX, tileY, pixelX, pixelY } = lngLatToTilePixel(lngLat.lng, lngLat.lat, zoom);
    const tile = await archive.getZxy(zoom, tileX, tileY);
    if (!tile || !tile.data) return null;
    const bytes = tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
    const elevation = await decodeDepthAtPixel(bytes, pixelX, pixelY);
    if (elevation == null) return null;
    return { elevation, zoom };
  }

  // ── Protocols ───────────────────────────────────────────────────────────────

  function detectMimeType(bytes) {
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    return 'application/octet-stream';
  }

  function decodeTerrainRgbElevation(r, g, b) {
    return (r * 65536 + g * 256 + b) * 0.1 - 10000;
  }

  async function recolorTerrainRgbTile(tileBytes, paletteName) {
    const lut = paletteLuts[paletteName] || paletteLuts.rainbowcolour;
    const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const srcBitmap = await createImageBitmap(blob);
    
    const canvas = document.createElement('canvas');
    canvas.width = srcBitmap.width;
    canvas.height = srcBitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    const lutMax = LUT_SIZE - 1;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      if (elevation > 0) {
        data[i + 3] = 0;
        continue;
      }
      const idx = ((elevation - LUT_MIN) / LUT_RANGE * lutMax + 0.5) | 0;
      const li = (idx < 0 ? 0 : idx > lutMax ? lutMax : idx) * 3;
      data[i] = lut[li];
      data[i + 1] = lut[li + 1];
      data[i + 2] = lut[li + 2];
      data[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    return createImageBitmap(canvas);
  }

  function parseRawRgbUrl(url) {
    const withoutScheme = url.replace(/^(rawrgb|boostdem)pmtiles:\/\//, '');
    const [pathPart, queryPart = ''] = withoutScheme.split('?');
    const match = pathPart.match(/^(.+\.pmtiles)\/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) throw new Error(`Invalid rawrgbpmtiles URL: ${url}`);
    const pmtilesHref = new URL(match[1], window.location.href).toString();
    const params = new URLSearchParams(queryPart);
    return {
      pmtilesUrl: pmtilesHref,
      z: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
      palette: params.get('palette') || 'rainbowcolour',
      mode: params.get('mode') || 'depth',
    };
  }

  // Register Protocols
  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

  function fetchRawTileBytes(pmtilesUrl, z, x, y) {
    const key = `${pmtilesUrl}:${z}/${x}/${y}`;
    let promise = rawBytesCache.get(key);
    if (!promise) {
      promise = (async () => {
        const archive = getPmtilesArchive(pmtilesUrl);
        const tile = await archive.getZxy(z, x, y);
        if (!tile || !tile.data) return null;
        return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
      })();
      while (rawBytesCache.size >= MAX_RAW_CACHE_SIZE) {
        rawBytesCache.delete(rawBytesCache.keys().next().value);
      }
      rawBytesCache.set(key, promise);
    }
    return promise;
  }

  maplibregl.addProtocol('rawrgbpmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };
    const { pmtilesUrl, z, x, y, palette } = parseRawRgbUrl(params.url);
    const bytes = await fetchRawTileBytes(pmtilesUrl, z, x, y);
    if (!bytes) return { data: new Uint8Array() };
    const bitmap = await recolorTerrainRgbTile(bytes, palette);
    return { data: bitmap };
  });

  maplibregl.addProtocol('boostdempmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };
    const { pmtilesUrl, z, x, y, mode } = parseRawRgbUrl(params.url);
    const bytes = await fetchRawTileBytes(pmtilesUrl, z, x, y);

    if (!bytes) return { data: new Uint8Array() };

    const blob = new Blob([bytes], { type: detectMimeType(bytes) });
    const srcBitmap = await createImageBitmap(blob);
    
    const canvas = document.createElement('canvas');
    canvas.width = srcBitmap.width;
    canvas.height = srcBitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    for (let i = 0; i < data.length; i += 4) {
      let elevation = 0;
      if (data[i + 3] !== 0) {
        elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      }
      
      // Handle land (clamped to 0 for bathymetry focus)
      let targetElevation = elevation > 0 ? 0 : elevation;

      // Depth as Height (Inverted)
      if (mode === 'height') {
        targetElevation = -targetElevation;
      }
      
      // Re-encode to Mapbox Terrain-RGB
      const newRaw = Math.max(0, Math.round((targetElevation + 10000) * 10));
      
      data[i] = (newRaw >> 16) & 0xFF;
      data[i + 1] = (newRaw >> 8) & 0xFF;
      data[i + 2] = newRaw & 0xFF;
      data[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    return { data: bitmap };
  });

  const styleSelect      = document.getElementById('style-select');
  const landSelect       = document.getElementById('land-select');
  const labelsToggle     = document.getElementById('labels-toggle');
  const depthModeSelect  = document.getElementById('depth-mode-select');
  const legendContainer  = document.getElementById('legend-container');
  const legendGradient   = document.getElementById('legend-gradient');
  const legendLabels     = document.getElementById('legend-labels');
  const panel            = document.getElementById('panel');
  const panelToggle      = document.getElementById('panel-toggle');

  panelToggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  const SATELLITE_LAYER_ID = 'satellite-layer';
  const LABEL_LAYER_ID     = 'country-labels';
  const BOUNDARY_LAYER_ID  = 'country-boundaries';

  const map = new maplibregl.Map({
    container: 'map',
    style: mapStyle,
    center: [-27, 18],
    zoom: 3,
    maxZoom: 10,
    pitch: 60,
    bearing: 0,
    maxPitch: 85,
    attributionControl: false
  });

  const zoomVal = document.getElementById('zoom-val');
  map.on('zoom', () => {
    zoomVal.textContent = map.getZoom().toFixed(1);
  });

  let attributionControl = null;

  function refreshLandThemeAttribution() {
    if (attributionControl) map.removeControl(attributionControl);
    const attributions = styleDoc.metadata?.attributions || {};
    attributionControl = new maplibregl.AttributionControl({
      compact: true,
      customAttribution: attributions[landSelect.value] || attributions.dark
    });
    map.addControl(attributionControl, 'bottom-right');
  }

  function applyBasemapOptions() {
    const landTheme    = landSelect.value;
    const labelsVisible = labelsToggle.checked;
    const themes       = styleDoc.metadata?.themes || {};
    const colors       = themes[landTheme] || themes.dark;

    map.setLayoutProperty('background', 'visibility', 'none');
    map.setPaintProperty('background', 'background-color', colors.land);
    map.setLayoutProperty('background', 'visibility', 'visible');

    if (map.getLayer(SATELLITE_LAYER_ID)) {
      map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', landTheme === 'satellite' ? 'visible' : 'none');
    }

    if (map.getLayer(BOUNDARY_LAYER_ID)) {
      map.setPaintProperty(BOUNDARY_LAYER_ID, 'line-color', colors.boundary);
    }

    if (map.getLayer(LABEL_LAYER_ID)) {
      map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', labelsVisible ? 'visible' : 'none');
      map.setPaintProperty(LABEL_LAYER_ID, 'text-color', colors.label);
      map.setPaintProperty(LABEL_LAYER_ID, 'text-halo-color', colors.halo);
    }

    refreshLandThemeAttribution();
    map.triggerRepaint();
    
    // Tiny camera nudge to force 3D engine update
    const b = map.getBearing();
    map.setBearing(b + 0.000001);
    map.setBearing(b);
  }

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  styleSelect.addEventListener('change', (e) => {
    const palette = e.target.value;
    const src = map.getSource('gebco-raster');
    if (src && src.setTiles) {
      src.setTiles([`rawrgbpmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?palette=${palette}`]);
    }
    updateLegend(palette);
  });

  landSelect.addEventListener('change', () => applyBasemapOptions());
  labelsToggle.addEventListener('change', () => applyBasemapOptions());

  depthModeSelect.addEventListener('change', () => {
    const mode = depthModeSelect.value;
    const src = map.getSource('terrain-source');
    if (src && src.setTiles) {
      src.setTiles([`boostdempmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?mode=${mode}`]);
    }
  });

  const exagSlider = document.getElementById('exag-slider');
  const exagVal    = document.getElementById('exag-val');
  exagSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    exagVal.textContent = val;
    map.setTerrain({ source: 'terrain-source', exaggeration: val });
  });

  function updateLegend(paletteName) {
    const palette = palettes[paletteName];
    
    if (!palette || !palette.stops || palette.stops.length === 0) {
      legendContainer.style.display = 'none';
      return;
    }
    
    legendContainer.style.display = 'block';
    
    // Sort stops to ensure gradient is correct
    const sortedStops = [...palette.stops].sort((a, b) => a[0] - b[0]);
    const minDepth = sortedStops[0][0];
    const maxDepth = sortedStops[sortedStops.length - 1][0];
    const range = maxDepth - minDepth;
    
    const cssGradient = sortedStops.map(stop => {
      const percent = ((stop[0] - minDepth) / range * 100).toFixed(1);
      const [r, g, b] = stop[1];
      return `rgb(${r}, ${g}, ${b}) ${percent}%`;
    }).join(', ');
    
    legendGradient.style.background = `linear-gradient(to right, ${cssGradient})`;
    
    // Generate simplified labels
    const midDepth = (minDepth + maxDepth) / 2;
    legendLabels.textContent = '';
    [minDepth, midDepth, maxDepth].forEach(d => {
      const span = document.createElement('span');
      span.textContent = `${Math.abs(d).toLocaleString()}m`;
      legendLabels.appendChild(span);
    });
  }

  map.on('load', () => {
    applyBasemapOptions();
    updateLegend(styleSelect.value);

    const depthPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'depth-popup' });
    const statusDiv = document.getElementById('compare-status');

    map.on('click', async (event) => {
      statusDiv.textContent = 'Sampling depth...';
      try {
        const result = await sampleDepthAtLngLat(map, event.lngLat);
        if (!result) {
          depthPopup.remove();
          statusDiv.textContent = 'No depth data at clicked point.';
          return;
        }
        const { elevation, zoom } = result;
        const depthLabel = elevation <= 0
          ? `${Math.abs(elevation).toFixed(1)} m below sea level`
          : `${elevation.toFixed(1)} m above sea level`;
        depthPopup
          .setLngLat(event.lngLat)
          .setHTML(`<strong>Depth:</strong> ${depthLabel}<br><span class="depth-zoom">Sample zoom z${zoom}</span>`)
          .addTo(map);
        statusDiv.textContent = 'Click the map to sample depth.';
      } catch (error) {
        console.error('Depth query failed', error);
        depthPopup.remove();
        statusDiv.textContent = 'Depth query failed.';
      }
    });
  });

})().catch((error) => {
  console.error('Failed to initialize 3D terrain demo', error);
});
