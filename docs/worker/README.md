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

Because this folder now lives under `docs/`, it can be published by a standard GitHub Pages setup that serves from the `docs/` directory.

If this repository is published as a project site, the test build should be reachable at `/worker/` under the site root.
