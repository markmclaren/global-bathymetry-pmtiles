// Tile recolouring worker.
// Runs pixel-level Raw RGB → palette conversion off the main thread.
//
// Receives:  { id: number, tileBytes: Uint8Array, stops: Array }
//            tileBytes.buffer is transferred to avoid copying.
// Sends back: { id, bitmap: ImageBitmap }  (bitmap transferred)
//          or { id, error: string } on failure.

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

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function decodeTerrainRgbElevation(r, g, b) {
  return (r * 65536 + g * 256 + b) * 0.1 - 10000;
}

function depthColor(depthMeters, stops) {
  if (!Array.isArray(stops) || stops.length === 0) return [0, 0, 0];
  if (depthMeters <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (depthMeters <= b[0]) {
      const t = (depthMeters - a[0]) / (b[0] - a[0]);
      return [
        clampByte(a[1][0] + (b[1][0] - a[1][0]) * t),
        clampByte(a[1][1] + (b[1][1] - a[1][1]) * t),
        clampByte(a[1][2] + (b[1][2] - a[1][2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

self.onmessage = async ({ data: { id, tileBytes, stops } }) => {
  try {
    const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
    const srcBitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(srcBitmap.width, srcBitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcBitmap, 0, 0);
    srcBitmap.close();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;

      const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
      if (elevation > 0) {
        data[i + 3] = 0;
        continue;
      }

      const [r, g, b] = depthColor(elevation, stops);
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
