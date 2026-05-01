// Tile recolouring worker.
// Runs pixel-level Raw RGB → palette conversion off the main thread.
//
// Protocol:
//   Init:    { type: 'init', palettes }
//            Worker builds a 2048-entry Uint8Array LUT per palette.
//   Recolor: { type: 'recolor', id, tileBytes: Uint8Array, paletteName }
//            tileBytes.buffer is transferred to avoid copying.
//   Reply:   { id, bitmap: ImageBitmap }  (bitmap transferred)
//        or: { id, error: string }

// ── LUT constants (must match app.js values) ──────────────────────────────────
const LUT_SIZE  = 2048;
const LUT_MIN   = -11000;
const LUT_RANGE = 11000; // 0 − (−11 000)
const LUT_MAX_IDX = LUT_SIZE - 1;

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
    const elev = LUT_MIN + (i / LUT_MAX_IDX) * LUT_RANGE;
    const [r, g, b] = _depthColorRaw(elev, stops);
    lut[i * 3]     = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}
// ─────────────────────────────────────────────────────────────────────────────

// Palette LUTs — populated on 'init' message.
const paletteLuts = {};

// Reuse a single OffscreenCanvas across messages.
// Resized only when a tile with different dimensions arrives (very rare).
let _canvas = null;
let _ctx    = null;

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

self.onmessage = async ({ data }) => {
  // ── Init: build LUTs from palette definitions ────────────────────────────────
  if (data.type === 'init') {
    for (const [name, pal] of Object.entries(data.palettes)) {
      paletteLuts[name] = buildLut(pal.stops || []);
    }
    return;
  }

  // ── Recolor ──────────────────────────────────────────────────────────────────
  const { id, tileBytes, paletteName } = data;

  try {
    const lut = paletteLuts[paletteName] || paletteLuts.rainbowcolour;

    const blob      = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const srcBitmap = await createImageBitmap(blob);
    const w = srcBitmap.width, h = srcBitmap.height;

    // Reuse the persistent OffscreenCanvas; only reallocate when size changes.
    if (!_canvas || _canvas.width !== w || _canvas.height !== h) {
      _canvas = new OffscreenCanvas(w, h);
      _ctx    = _canvas.getContext('2d', { willReadFrequently: true });
    } else {
      _ctx.clearRect(0, 0, w, h);
    }

    _ctx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img  = _ctx.getImageData(0, 0, w, h);
    const data = img.data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;

      const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);

      if (elevation > 0) {
        data[i + 3] = 0;
        continue;
      }

      // O(1) LUT lookup — no linear stop-scan, no clamping call.
      const idx = ((elevation - LUT_MIN) / LUT_RANGE * LUT_MAX_IDX + 0.5) | 0;
      const li  = (idx < 0 ? 0 : idx > LUT_MAX_IDX ? LUT_MAX_IDX : idx) * 3;
      data[i]     = lut[li];
      data[i + 1] = lut[li + 1];
      data[i + 2] = lut[li + 2];
      data[i + 3] = 255;
    }

    _ctx.putImageData(img, 0, 0);
    const bitmap = _canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
