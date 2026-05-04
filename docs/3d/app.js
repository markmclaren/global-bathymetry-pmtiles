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

  // ── LRU cache helpers ─────────────────────────────────────────────────────────
  function lruGet(cache, key) {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }

  function lruSet(cache, key, value, maxSize) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > maxSize) cache.delete(cache.keys().next().value);
  }

  // ── Cache & Sampling helpers ───────────────────────────────────────────────
  const pmtilesCache        = new Map();
  const rawBytesCache       = new Map();
  const recolouredTileCache = new Map();
  const MAX_RAW_CACHE_SIZE       = 512;
  const MAX_RECOLOURED_CACHE_SIZE = 512;

  // Separate canvases for each protocol to avoid async race conditions:
  // both protocols use await (suspension points) so a shared canvas would
  // allow concurrent calls to overwrite each other's pixel data.
  const tileCanvas  = document.createElement('canvas'); // rawrgbpmtiles
  const tileCtx     = tileCanvas.getContext('2d', { willReadFrequently: true });
  const boostCanvas = document.createElement('canvas'); // boostdempmtiles
  const boostCtx    = boostCanvas.getContext('2d', { willReadFrequently: true });
  const queryCanvas = document.createElement('canvas'); // depth sampling
  const queryCtx    = queryCanvas.getContext('2d', { willReadFrequently: true });

  let _cachedMaxZoom = null;

  function getPmtilesArchive(url) {
    if (!pmtilesCache.has(url)) pmtilesCache.set(url, new pmtiles.PMTiles(url));
    return pmtilesCache.get(url);
  }

  function getPmtilesHeader(url) {
    return getPmtilesArchive(url).getHeader();
  }

  // Warm up the PMTiles header cache
  getPmtilesHeader(RAWRGB_PMTILES_URL);

  function detectMimeType(bytes) {
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    if (bytes.length >= 8  && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3  && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    return 'application/octet-stream';
  }

  function decodeTerrainRgbElevation(r, g, b) {
    return (r * 65536 + g * 256 + b) * 0.1 - 10000;
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

  async function getDepthQueryMaxZoom() {
    if (_cachedMaxZoom !== null) return _cachedMaxZoom;
    const header = await getPmtilesHeader(RAWRGB_PMTILES_URL);
    _cachedMaxZoom = Math.max(0, Number(header.maxZoom || 0));
    return _cachedMaxZoom;
  }

  async function decodeDepthAtPixel(tileBytes, pixelX, pixelY) {
    const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const bitmap = await createImageBitmap(blob);
    queryCanvas.width  = bitmap.width;
    queryCanvas.height = bitmap.height;
    queryCtx.clearRect(0, 0, queryCanvas.width, queryCanvas.height); // prevent pixel bleed
    queryCtx.drawImage(bitmap, 0, 0);
    const px = queryCtx.getImageData(pixelX, pixelY, 1, 1).data;
    bitmap.close();
    if (px[3] === 0) return null;
    return decodeTerrainRgbElevation(px[0], px[1], px[2]);
  }

  async function sampleDepthAtLngLat(map, lngLat) {
    const archive  = getPmtilesArchive(RAWRGB_PMTILES_URL);
    const maxZoom  = await getDepthQueryMaxZoom(); // dynamic, not hard-coded
    const zoom     = Math.max(0, Math.min(maxZoom, Math.floor(map.getZoom())));
    const { tileX, tileY, pixelX, pixelY } = lngLatToTilePixel(lngLat.lng, lngLat.lat, zoom);
    const tile = await archive.getZxy(zoom, tileX, tileY);
    if (!tile || !tile.data) return null;
    const bytes = tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
    const elevation = await decodeDepthAtPixel(bytes, pixelX, pixelY);
    if (elevation == null) return null;
    return { elevation, zoom };
  }

  // ── Tile recolouring ─────────────────────────────────────────────────────────

  async function recolorTerrainRgbTile(tileBytes, paletteName, landHex) {
    const lut = paletteLuts[paletteName] || paletteLuts.rainbowcolour;
    // Decode land color so we can paint it directly into land pixels.
    // This avoids relying on the background layer, which doesn't reliably
    // update in globe+terrain render-to-texture mode.
    const lh = landHex || '191a1a';
    const landR = parseInt(lh.slice(0, 2), 16);
    const landG = parseInt(lh.slice(2, 4), 16);
    const landB = parseInt(lh.slice(4, 6), 16);

    const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const srcBitmap = await createImageBitmap(blob);

    tileCanvas.width  = srcBitmap.width;
    tileCanvas.height = srcBitmap.height;
    tileCtx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
    tileCtx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img  = tileCtx.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
    const data = img.data;
    const lutMax = LUT_SIZE - 1;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      if (elevation > 0) {
        // Paint land with the theme color (opaque) instead of making it transparent.
        // Changing landHex in the URL forces tile re-render, which correctly
        // updates the terrain texture without fighting the render-to-texture cache.
        data[i]     = landR;
        data[i + 1] = landG;
        data[i + 2] = landB;
        data[i + 3] = 255;
        continue;
      }
      const idx = ((elevation - LUT_MIN) / LUT_RANGE * lutMax + 0.5) | 0;
      const li  = (idx < 0 ? 0 : idx > lutMax ? lutMax : idx) * 3;
      data[i]     = lut[li];
      data[i + 1] = lut[li + 1];
      data[i + 2] = lut[li + 2];
      data[i + 3] = 255;
    }

    tileCtx.putImageData(img, 0, 0);
    return createImageBitmap(tileCanvas);
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
      land:    params.get('land')    || '191a1a',
      mode:    params.get('mode')    || 'depth',
    };
  }

  // ── Protocols ───────────────────────────────────────────────────────────────

  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

  maplibregl.addProtocol('rawrgbpmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };

    // Check LRU recoloured cache first
    const cacheKey = params.url;
    const cachedBitmapPromise = lruGet(recolouredTileCache, cacheKey);
    if (cachedBitmapPromise) return { data: await cachedBitmapPromise };

    const { pmtilesUrl, z, x, y, palette, land } = parseRawRgbUrl(params.url);
    const rawKey = `${pmtilesUrl}:${z}/${x}/${y}`;

    const recolourPromise = (async () => {
      if (params.signal?.aborted) return new Uint8Array();
      let rawPromise = lruGet(rawBytesCache, rawKey);
      if (!rawPromise) {
        rawPromise = (async () => {
          const archive = getPmtilesArchive(pmtilesUrl);
          const tile = await archive.getZxy(z, x, y);
          if (!tile || !tile.data) return null;
          return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
        })();
        lruSet(rawBytesCache, rawKey, rawPromise, MAX_RAW_CACHE_SIZE);
      }
      const bytes = await rawPromise;
      if (!bytes) return new Uint8Array();
      if (params.signal?.aborted) return new Uint8Array();
      return recolorTerrainRgbTile(bytes, palette, land);
    })();

    lruSet(recolouredTileCache, cacheKey, recolourPromise, MAX_RECOLOURED_CACHE_SIZE);
    try {
      const bitmap = await recolourPromise;
      return { data: bitmap };
    } catch (error) {
      recolouredTileCache.delete(cacheKey);
      throw error;
    }
  });

  maplibregl.addProtocol('boostdempmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };
    const { pmtilesUrl, z, x, y, mode } = parseRawRgbUrl(params.url);

    let rawPromise = lruGet(rawBytesCache, `${pmtilesUrl}:${z}/${x}/${y}`);
    if (!rawPromise) {
      rawPromise = (async () => {
        const archive = getPmtilesArchive(pmtilesUrl);
        const tile = await archive.getZxy(z, x, y);
        if (!tile || !tile.data) return null;
        return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
      })();
      lruSet(rawBytesCache, `${pmtilesUrl}:${z}/${x}/${y}`, rawPromise, MAX_RAW_CACHE_SIZE);
    }

    const bytes = await rawPromise;
    if (!bytes) return { data: new Uint8Array() };

    const blob = new Blob([bytes], { type: detectMimeType(bytes) });
    const srcBitmap = await createImageBitmap(blob);

    boostCanvas.width  = srcBitmap.width;
    boostCanvas.height = srcBitmap.height;
    boostCtx.clearRect(0, 0, boostCanvas.width, boostCanvas.height);
    boostCtx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img  = boostCtx.getImageData(0, 0, boostCanvas.width, boostCanvas.height);
    const data = img.data;

    for (let i = 0; i < data.length; i += 4) {
      let elevation = 0;
      if (data[i + 3] !== 0) {
        elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      }
      let targetElevation = elevation > 0 ? 0 : elevation;
      if (mode === 'height') targetElevation = -targetElevation;

      const newRaw = Math.max(0, Math.round((targetElevation + 10000) * 10));
      data[i]     = (newRaw >> 16) & 0xFF;
      data[i + 1] = (newRaw >> 8)  & 0xFF;
      data[i + 2] =  newRaw        & 0xFF;
      data[i + 3] = 255;
    }

    boostCtx.putImageData(img, 0, 0);
    const bitmap = await createImageBitmap(boostCanvas);
    return { data: bitmap };
  });

  // ── UI elements ──────────────────────────────────────────────────────────────

  const styleSelect     = document.getElementById('style-select');
  const landSelect      = document.getElementById('land-select');
  const labelsToggle    = document.getElementById('labels-toggle');
  const depthModeSelect = document.getElementById('depth-mode-select');
  const legendContainer = document.getElementById('legend-container');
  const legendGradient  = document.getElementById('legend-gradient');
  const legendLabels    = document.getElementById('legend-labels');
  const panel           = document.getElementById('panel');
  const panelToggle     = document.getElementById('panel-toggle');

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
    // Guard: do nothing if the map style isn't loaded yet
    if (!map.loaded()) return;

    const landTheme     = landSelect.value;
    const labelsVisible = labelsToggle.checked;
    const themes        = styleDoc.metadata?.themes || {};
    const colors        = themes[landTheme] || themes.dark;
    const showSat       = landTheme === 'satellite';
    // For satellite theme the satellite raster is on top, land color doesn't matter visually.
    // Use black to match the satellite theme's land value.
    const landHex = colors.land.replace('#', '');

    map.setPaintProperty('background', 'background-color', colors.land);

    // Update tile URL with new land color (same mechanism as palette switching)
    const src = map.getSource('gebco-raster');
    if (src && src.setTiles) {
      src.setTiles([`rawrgbpmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?palette=${styleSelect.value}&land=${landHex}`]);
    }

    // Force terrain render-to-texture cache rebuild.
    // Terrain only rebuilds on a LAYER VISIBILITY change — source tile changes alone
    // don't trigger it. We briefly show the satellite layer (it has no cached tiles
    // for the current view so renders transparent for one frame), then hide it.
    // The visibility change forces terrain to rebuild with the new land-coloured tiles.
    if (map.getLayer(SATELLITE_LAYER_ID)) {
      if (showSat) {
        map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', 'visible');
      } else {
        map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', 'visible');
        requestAnimationFrame(() => map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', 'none'));
      }
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
  }

  function updateLegend(paletteName) {
    const palette = palettes[paletteName];

    if (!palette || !palette.stops || palette.stops.length === 0) {
      legendContainer.style.display = 'none';
      return;
    }

    legendContainer.style.display = 'block';

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

    const midDepth = (minDepth + maxDepth) / 2;
    legendLabels.textContent = '';
    [minDepth, midDepth, maxDepth].forEach(d => {
      const span = document.createElement('span');
      span.textContent = `${Math.abs(d).toLocaleString()}m`;
      legendLabels.appendChild(span);
    });
  }

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const exagSlider = document.getElementById('exag-slider');
  const exagVal    = document.getElementById('exag-val');
  exagSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    exagVal.textContent = val;
    map.setTerrain({ source: 'terrain-source', exaggeration: val });
  });

  map.on('load', () => {
    applyBasemapOptions();
    updateLegend(styleSelect.value);

    // Register interactive listeners inside load so map is guaranteed ready
    landSelect.addEventListener('change', () => applyBasemapOptions());
    labelsToggle.addEventListener('change', () => applyBasemapOptions());

    styleSelect.addEventListener('change', (e) => {
      const palette = e.target.value;
      const src = map.getSource('gebco-raster');
      if (src && src.setTiles) {
        const themes  = styleDoc.metadata?.themes || {};
        const colors  = themes[landSelect.value] || themes.dark;
        const landHex = colors.land.replace('#', '');
        src.setTiles([`rawrgbpmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?palette=${palette}&land=${landHex}`]);
      }
      updateLegend(palette);
    });

    depthModeSelect.addEventListener('change', () => {
      const mode = depthModeSelect.value;
      const src = map.getSource('terrain-source');
      if (src && src.setTiles) {
        src.setTiles([`boostdempmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?mode=${mode}`]);
      }
    });

    const depthPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'depth-popup' });
    const statusDiv  = document.getElementById('compare-status');

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
