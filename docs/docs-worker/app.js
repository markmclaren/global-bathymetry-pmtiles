(async () => {
  const styleResponse = await fetch('styles.json');
  const styleDoc = await styleResponse.json();
  const palettes = styleDoc.metadata?.palettes || {};

  const compareStatus = document.getElementById('compare-status');
  const styleSelect = document.getElementById('style-select');
  const landSelect = document.getElementById('land-select');
  const labelsToggle = document.getElementById('labels-toggle');

  const BASE_SOURCE_ID = 'carto-dark';
  const LABEL_SOURCE_ID = 'carto-labels';
  const LABEL_LAYER_ID = 'carto-labels-layer';
  const RAWRGB_PMTILES_URL = 'https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles/resolve/main/gebco-2025-rawrgb-z0-6-webp.pmtiles';

  // ── Worker pool ───────────────────────────────────────────────────────────────
  // Workers receive the palettes object once at init (avoids serialising stops
  // on every postMessage). Dispatch uses a least-pending strategy so no single
  // worker is overloaded with slow low-zoom tiles.
  const WORKER_COUNT  = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 6));
  const workerPool    = [];
  const workerLoad    = [];          // pending task count per worker
  const workerPending = new Map();   // msgId → { resolve, reject, workerIdx }
  let nextMsgId = 0;

  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new Worker('tile-worker.js');

    // Send palettes once so the worker can build LUTs and look up by name.
    w.postMessage({ type: 'init', palettes });

    w.onmessage = ({ data: { id, bitmap, error } }) => {
      const pending = workerPending.get(id);
      if (!pending) return;
      workerPending.delete(id);
      workerLoad[pending.workerIdx]--;
      if (error) pending.reject(new Error(error));
      else pending.resolve(bitmap);
    };
    w.onerror = (evt) => console.error('Tile worker error', evt);

    workerPool.push(w);
    workerLoad.push(0);
  }

  function workerRecolor(tileBytes, paletteName) {
    return new Promise((resolve, reject) => {
      const id = nextMsgId++;

      // Least-pending dispatch: choose the worker with the smallest queue.
      let minLoad = Infinity, workerIdx = 0;
      for (let i = 0; i < WORKER_COUNT; i++) {
        if (workerLoad[i] < minLoad) { minLoad = workerLoad[i]; workerIdx = i; }
      }
      workerLoad[workerIdx]++;

      // Slice to avoid neutering the original buffer (PMTiles may reuse it).
      const copy = tileBytes.slice();
      workerPending.set(id, { resolve, reject, workerIdx });
      workerPool[workerIdx].postMessage({ type: 'recolor', id, tileBytes: copy, paletteName }, [copy.buffer]);
    });
  }
  // ─────────────────────────────────────────────────────────────────────────────

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
  // ─────────────────────────────────────────────────────────────────────────────

  const pmtilesCache = new Map();

  // Two-level cache: raw bytes (palette-independent) + recoloured bitmaps.
  // Palette switches hit only the recolour cache miss — no extra network fetch.
  const rawBytesCache       = new Map();
  const recolouredTileCache = new Map();
  const MAX_RAW_CACHE_SIZE        = 512;
  const MAX_RECOLOURED_CACHE_SIZE = 512;

  const queryCanvas = document.createElement('canvas');
  const queryCtx    = queryCanvas.getContext('2d', { willReadFrequently: true });

  let activePalette  = styleSelect.value;
  let appliedPalette = null;
  let _cachedMaxZoom = null; // constant for the page lifetime; cached after first fetch

  const CARTO_BASEMAPS = {
    dark: {
      base: [
        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'
      ],
      labels: [
        'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'
      ]
    },
    light: {
      base: [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'
      ],
      labels: [
        'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'
      ]
    },
    satellite: {
      base: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
      ],
      labels: [
        'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'
      ]
    }
  };

  const LAND_THEME_ATTRIBUTION = {
    dark: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    light: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    satellite: '&copy; <a href="https://s2maps.eu/">s2maps.eu</a> / Sentinel-2 cloudless by EOX'
  };

  function getPmtilesArchive(url) {
    if (!pmtilesCache.has(url)) pmtilesCache.set(url, new pmtiles.PMTiles(url));
    return pmtilesCache.get(url);
  }

  function getPmtilesHeader(url) {
    return getPmtilesArchive(url).getHeader();
  }

  // Warm up the PMTiles header immediately so the first depth query is instant.
  getPmtilesHeader(RAWRGB_PMTILES_URL);

  function detectMimeType(bytes) {
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    return 'application/octet-stream';
  }

  function decodeTerrainRgbElevation(r, g, b) {
    return (r * 65536 + g * 256 + b) * 0.1 - 10000;
  }

  function parseRawRgbUrl(url) {
    const withoutScheme = url.replace(/^rawrgbpmtiles:\/\//, '');
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
    };
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

  // maxZoom is constant for the page lifetime — cache after first resolve.
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
    queryCtx.clearRect(0, 0, queryCanvas.width, queryCanvas.height);
    queryCtx.drawImage(bitmap, 0, 0);
    const px = queryCtx.getImageData(pixelX, pixelY, 1, 1).data;
    bitmap.close();
    if (px[3] === 0) return null;
    return decodeTerrainRgbElevation(px[0], px[1], px[2]);
  }

  async function sampleDepthAtLngLat(map, lngLat) {
    const archive = getPmtilesArchive(RAWRGB_PMTILES_URL);
    const maxZoom = await getDepthQueryMaxZoom();
    const zoom    = Math.max(0, Math.min(maxZoom, Math.floor(map.getZoom())));
    const { tileX, tileY, pixelX, pixelY } = lngLatToTilePixel(lngLat.lng, lngLat.lat, zoom);
    const tile = await archive.getZxy(zoom, tileX, tileY);
    if (!tile || !tile.data) return null;
    const bytes = tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
    const elevation = await decodeDepthAtPixel(bytes, pixelX, pixelY);
    if (elevation == null) return null;
    return { elevation, zoom };
  }

  maplibregl.addProtocol('rawrgbpmtiles', async (params) => {
    // Respect MapLibre cancellation — skip work for tiles that scrolled away.
    if (params.signal?.aborted) return { data: new Uint8Array() };

    const cacheKey = params.url;
    const cached = lruGet(recolouredTileCache, cacheKey);
    if (cached) return { data: await cached };

    const { pmtilesUrl, z, x, y, palette } = parseRawRgbUrl(params.url);
    // Raw-bytes key is palette-independent: palette switches reuse fetched data.
    const rawKey = `${z}/${x}/${y}`;

    const recolourPromise = (async () => {
      if (params.signal?.aborted) return new Uint8Array();

      // Fetch raw bytes once; subsequent requests for the same tile (any palette)
      // resolve from cache without a network round-trip.
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

      return workerRecolor(bytes, palette);
    })();

    lruSet(recolouredTileCache, cacheKey, recolourPromise, MAX_RECOLOURED_CACHE_SIZE);

    try {
      return { data: await recolourPromise };
    } catch (error) {
      recolouredTileCache.delete(cacheKey);
      throw error;
    }
  });

  function addLabelSourceAndLayer(style, theme, labelsVisible) {
    if (style.sources[BASE_SOURCE_ID]) style.sources[BASE_SOURCE_ID].attribution = '';
    style.sources[LABEL_SOURCE_ID] = {
      type: 'raster',
      tiles: CARTO_BASEMAPS[theme].labels,
      tileSize: 256,
      minzoom: 0,
      maxzoom: 20,
    };
    style.layers.splice(2, 0, {
      id: LABEL_LAYER_ID,
      type: 'raster',
      source: LABEL_SOURCE_ID,
      layout: { visibility: labelsVisible ? 'visible' : 'none' },
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 }
    });
  }

  addLabelSourceAndLayer(styleDoc, landSelect.value, labelsToggle.checked);

  const map = new maplibregl.Map({
    container: 'map',
    style: styleDoc,
    center: [-27, 18],
    zoom: 2.4,
    pitch: 30,
    bearing: 0,
    attributionControl: false
  });

  let attributionControl = null;

  function refreshLandThemeAttribution() {
    if (attributionControl) map.removeControl(attributionControl);
    attributionControl = new maplibregl.AttributionControl({
      compact: true,
      customAttribution: LAND_THEME_ATTRIBUTION[landSelect.value] || LAND_THEME_ATTRIBUTION.dark
    });
    map.addControl(attributionControl, 'bottom-right');
  }

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  function applyBasemapOptions() {
    const landTheme    = landSelect.value;
    const labelsVisible = labelsToggle.checked;
    const baseSource   = map.getSource(BASE_SOURCE_ID);
    if (baseSource && baseSource.setTiles) baseSource.setTiles(CARTO_BASEMAPS[landTheme].base);
    const labelSource = map.getSource(LABEL_SOURCE_ID);
    if (labelSource && labelSource.setTiles) labelSource.setTiles(CARTO_BASEMAPS[landTheme].labels);
    if (map.getLayer(LABEL_LAYER_ID)) {
      map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', labelsVisible ? 'visible' : 'none');
    }
    refreshLandThemeAttribution();
  }

  function setActiveStyle(styleName) {
    const src = map.getSource('gebco-rawrgb-styled');
    if (!src || !src.setTiles) return;
    if (appliedPalette === styleName) return;
    activePalette  = styleName;
    appliedPalette = styleName;
    src.setTiles([`rawrgbpmtiles://${RAWRGB_PMTILES_URL}/{z}/{x}/{y}?palette=${styleName}`]);
    compareStatus.textContent = 'Click the map to sample depth.';
  }

  labelsToggle.addEventListener('change', () => applyBasemapOptions());
  landSelect.addEventListener('change', () => applyBasemapOptions());

  map.on('load', () => {
    map.setProjection({ type: 'globe' });

    const depthPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'depth-popup' });

    map.on('click', async (event) => {
      compareStatus.textContent = 'Sampling depth...';
      try {
        const result = await sampleDepthAtLngLat(map, event.lngLat);
        if (!result) {
          depthPopup.remove();
          compareStatus.textContent = 'No depth data at clicked point.';
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
        compareStatus.textContent = 'Click the map to sample depth.';
      } catch (error) {
        console.error('Depth query failed', error);
        depthPopup.remove();
        compareStatus.textContent = 'Depth query failed. Check console for details.';
      }
    });

    styleSelect.addEventListener('change', (event) => setActiveStyle(event.target.value));
    setActiveStyle(styleSelect.value);
    applyBasemapOptions();
  });
})().catch((error) => {
  console.error('Failed to initialize RawRGB style demo', error);
});
