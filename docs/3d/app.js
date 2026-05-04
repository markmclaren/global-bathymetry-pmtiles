(async () => {
  const styleResponse = await fetch('../styles.json');
  const styleDoc = await styleResponse.json();
  const palettes = styleDoc.metadata?.palettes || {};

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

  const tileCanvas = document.createElement('canvas');
  const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
  const queryCanvas = document.createElement('canvas');
  const queryCtx    = queryCanvas.getContext('2d', { willReadFrequently: true });
  let _cachedMaxZoom = null;

  function getPmtilesArchive(url) {
    if (!pmtilesCache.has(url)) pmtilesCache.set(url, new pmtiles.PMTiles(url));
    return pmtilesCache.get(url);
  }

  function lngLatToTilePixel(lng, lat, zoom) {
    const n = Math.pow(2, zoom);
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
    const canvas = document.createElement('canvas');
    canvas.width  = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(pixelX, pixelY, 1, 1).data;
    bitmap.close();
    if (px[3] === 0) return null;
    
    return decodeTerrainRgbElevation(px[0], px[1], px[2]);
  }

  async function sampleDepthAtLngLat(map, lngLat) {
    const archive  = getPmtilesArchive(RAWRGB_PMTILES_URL);
    const maxZoom  = 6;
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

  maplibregl.addProtocol('rawrgbpmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };
    const { pmtilesUrl, z, x, y, palette } = parseRawRgbUrl(params.url);
    const rawKey = `raster:${pmtilesUrl}:${z}/${x}/${y}`;

    let rawPromise = rawBytesCache.get(rawKey);
    if (!rawPromise) {
      rawPromise = (async () => {
        const archive = getPmtilesArchive(pmtilesUrl);
        const tile = await archive.getZxy(z, x, y);
        if (!tile || !tile.data) return null;
        return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
      })();
      if (rawBytesCache.size > MAX_RAW_CACHE_SIZE) rawBytesCache.delete(rawBytesCache.keys().next().value);
      rawBytesCache.set(rawKey, rawPromise);
    }

    const bytes = await rawPromise;
    if (!bytes) return { data: new Uint8Array() };
    const bitmap = await recolorTerrainRgbTile(bytes, palette);
    return { data: bitmap };
  });

  maplibregl.addProtocol('boostdempmtiles', async (params) => {
    if (params.signal?.aborted) return { data: new Uint8Array() };
    const { pmtilesUrl, z, x, y, mode } = parseRawRgbUrl(params.url);
    const rawKey = `dem:${pmtilesUrl}:${z}/${x}/${y}`;

    let rawPromise = rawBytesCache.get(rawKey);
    if (!rawPromise) {
      rawPromise = (async () => {
        const archive = getPmtilesArchive(pmtilesUrl);
        const tile = await archive.getZxy(z, x, y);
        if (!tile || !tile.data) return null;
        return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
      })();
      if (rawBytesCache.size > MAX_RAW_CACHE_SIZE) rawBytesCache.delete(rawBytesCache.keys().next().value);
      rawBytesCache.set(rawKey, rawPromise);
    }

    const bytes = await rawPromise;
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
      const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      
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

  const SATELLITE_LAYER_ID = 'satellite-layer';
  const LABEL_LAYER_ID     = 'country-labels';
  const BOUNDARY_LAYER_ID  = 'country-boundaries';

  const map = new maplibregl.Map({
    container: 'map',
    style: {
      "version": 8,
      "name": "GEBCO 3D Style",
      "projection": { "type": "globe" },
      "atmosphere": {
        "color": "#112233",
        "high-color": "#001122",
        "horizon-blend": 0.05
      },
      "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      "sources": {
        "osm-vector": {
          "type": "vector",
          "url": "https://tiles.openfreemap.org/planet",
          "attribution": "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"
        },
        "satellite-source": {
          "type": "raster",
          "tiles": ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"],
          "tileSize": 256,
          "attribution": "&copy; <a href=\"https://s2maps.eu/\">s2maps.eu</a>"
        },
        "terrain-source": {
          "type": "raster-dem",
          "tiles": [`boostdempmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}`],
          "tileSize": 256,
          "encoding": "mapbox",
          "maxzoom": 6
        },
        "gebco-raster": {
          "type": "raster",
          "tiles": [`rawrgbpmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?palette=rainbowcolour`],
          "tileSize": 256,
          "maxzoom": 6,
          "attribution": "Bathymetry &copy; <a href=\"https://www.gebco.net/\">GEBCO</a>"
        }
      },
      "layers": [
        {
          "id": "background",
          "type": "background",
          "paint": { "background-color": "#191a1a" }
        },
        {
          "id": SATELLITE_LAYER_ID,
          "type": "raster",
          "source": "satellite-source",
          "layout": { "visibility": "none" },
          "paint": { "raster-opacity": 1, "raster-fade-duration": 0 }
        },
        {
          "id": "gebco-layer",
          "type": "raster",
          "source": "gebco-raster",
          "paint": {
            "raster-opacity": 0.95,
            "raster-fade-duration": 0
          }
        },
        {
          "id": BOUNDARY_LAYER_ID,
          "type": "line",
          "source": "osm-vector",
          "source-layer": "boundary",
          "filter": ["all", ["==", "admin_level", 2], ["!=", "maritime", 1]],
          "paint": {
            "line-color": "#313333",
            "line-width": 1,
            "line-opacity": 0.5
          }
        },
        {
          "id": LABEL_LAYER_ID,
          "type": "symbol",
          "source": "osm-vector",
          "source-layer": "place",
          "filter": ["==", "class", "country"],
          "layout": {
            "text-field": "{name}",
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-transform": "none",
            "visibility": "none"
          },
          "paint": {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.7)",
            "text-halo-width": 2
          }
        }
      ],
      "terrain": {
        "source": "terrain-source",
        "exaggeration": 15
      }
    },
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

    map.setPaintProperty('background', 'background-color', colors.land);

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
    const container = document.getElementById('legend-container');
    const gradient = document.getElementById('legend-gradient');
    const labels = document.getElementById('legend-labels');
    
    if (!palette || !palette.stops || palette.stops.length === 0) {
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'block';
    
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
    
    gradient.style.background = `linear-gradient(to right, ${cssGradient})`;
    
    // Generate simplified labels
    const midDepth = (minDepth + maxDepth) / 2;
    labels.innerHTML = `
      <span>${Math.abs(minDepth).toLocaleString()}m</span>
      <span>${Math.abs(midDepth).toLocaleString()}m</span>
      <span>${Math.abs(maxDepth).toLocaleString()}m</span>
    `;
  }

  map.on('load', () => {
    applyBasemapOptions();
    updateLegend(styleSelect.value);

    const depthPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'depth-popup' });
    const panel = document.querySelector('.panel');
    const statusDiv = document.createElement('div');
    statusDiv.id = 'compare-status';
    statusDiv.style.fontSize = '11px';
    statusDiv.style.marginTop = '8px';
    statusDiv.style.opacity = '0.8';
    statusDiv.textContent = 'Click the map to sample depth.';
    panel.appendChild(statusDiv);

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
          .setHTML(`<strong>Depth:</strong> ${depthLabel}<br><span style="opacity:0.8">Sample zoom z${zoom}</span>`)
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
