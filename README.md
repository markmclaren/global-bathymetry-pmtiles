# Global Bathymetry PMTiles Demo

This repository hosts a web map demo for visualising global bathymetry from hosted PMTiles.

Live map:

[https://markmclaren.github.io/global-bathymetry-pmtiles/](https://markmclaren.github.io/global-bathymetry-pmtiles/)

## About This Project

I am a developer with a strong interest in mapping technologies.

I am not a bathymetry domain expert.

The goal of this project is to provide an interactive visualisation workflow for exploring bathymetry data in the browser.

### Motivation

I wanted to host a 2D bathymetry visualisation with enough detail to be genuinely useful. The styling from EMODnet caught my eye but it only covers European waters — I wanted something with global coverage.

The raw GEBCO source files are enormous, so they needed to be processed into a more compact, reusable web resource. The pipeline encodes depth values as Raw RGB raster tiles, compressed with WebP lossless, stored in a single PMTiles archive. The actual colouring is applied at render time using MapLibre GL JS styles, which keeps the tile data format-agnostic and makes palette changes cheap.

The result is a dataset small enough to self-host (served from Hugging Face) and a viewer that runs entirely in the browser with no server-side rendering.

## Scope And Support

This repository documents and publishes the project outputs at:

[https://markmclaren.github.io/global-bathymetry-pmtiles/](https://markmclaren.github.io/global-bathymetry-pmtiles/)

It is not intended to be a general support channel for configuring PMTiles with MapLibre, and I am not providing setup troubleshooting for third-party environments.

## Data Source

Hosted PMTiles dataset:

[https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles](https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles)

Data provenance note:

Current bathymetry content is derived from GEBCO sources, and visual styling is inspired by EMODnet bathymetry colour approaches.

## Important Warning

**⚠️ NOT FOR NAVIGATION.**

This project and dataset are NOT intended for navigation, route planning, marine operations, legal compliance, or any safety-critical use.

This project is intended for visualisation, exploration, and scientific or educational research workflows.

All data and software are provided "as is" and without warranties of any kind, express or implied, including accuracy, completeness, timeliness, merchantability, or fitness for a particular purpose.

You are responsible for how you use this data and this software.

No endorsement is implied by GEBCO, EMODnet, CARTO, EOX, s2maps.eu, MapLibre, or Hugging Face.

## Credits And Attribution

- GEBCO for bathymetry data foundations: [https://www.gebco.net/](https://www.gebco.net/)
- EMODnet for inspiration in approach and colour styling ideas: [https://emodnet.ec.europa.eu/](https://emodnet.ec.europa.eu/)
- CARTO for basemap and label raster tiles: [https://carto.com/attributions](https://carto.com/attributions)
- EOX and s2maps.eu for Sentinel-2 cloudless satellite base imagery: [https://tiles.maps.eox.at/](https://tiles.maps.eox.at/) and [https://s2maps.eu/](https://s2maps.eu/)
- MapLibre GL JS for web map rendering: [https://maplibre.org/](https://maplibre.org/)
- PMTiles for cloud-optimised single-file tiled data delivery: [https://protomaps.com/docs/pmtiles/](https://protomaps.com/docs/pmtiles/)

## Repository Layout

Files in [docs](docs):

- [index.html](docs/index.html): page shell and map controls.
- [app.js](docs/app.js): PMTiles loading, recolouring, and depth query behaviour.
- [app.css](docs/app.css): visual styling for the map and control panel.
- [styles.json](docs/styles.json): palette definitions and base style configuration.
