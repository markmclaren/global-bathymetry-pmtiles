# Web Worker Test Build

This folder contains an experimental version of the bathymetry viewer that keeps the main `docs/` build untouched.

## What Is Different

- Raw RGB tile recolouring runs in Web Workers instead of on the main UI thread.
- The worker uses `OffscreenCanvas` to decode and recolour tiles off-thread.
- MapLibre GL JS and PMTiles JS are loaded from jsDelivr instead of unpkg.
- The PMTiles header is warmed up on page load so the first depth query has less setup latency.

## Purpose

This build exists to compare perceived responsiveness against the current production version, especially while panning and zooming.

## Files

- `index.html`: worker-test page shell
- `app.js`: map setup and worker-backed tile pipeline
- `tile-worker.js`: off-thread tile recolouring worker
- `app.css`: copied from `docs/`
- `styles.json`: copied from `docs/`

## Important Note

If GitHub Pages is configured to publish only from the `docs/` folder, this top-level `docs-worker/` folder will not be served automatically. In that case, this folder is still useful for local testing or as a staging area before copying the test build under `docs/`.
