# Global Bathymetry PMTiles Demo

This repository hosts a web map demo for visualising global bathymetry from hosted PMTiles.

Live map:

[https://markmclaren.github.io/global-bathymetry-pmtiles/](https://markmclaren.github.io/global-bathymetry-pmtiles/)

## About This Project

I am a developer with a strong interest in mapping technologies.

I am not a bathymetry domain expert.

The goal of this project is to provide an interactive visualisation workflow for exploring bathymetry data in the browser.

## Scope And Support

This repository documents and publishes the project outputs at:

[https://markmclaren.github.io/global-bathymetry-pmtiles/](https://markmclaren.github.io/global-bathymetry-pmtiles/)

It is not intended to be a general support channel for configuring PMTiles with MapLibre, and I am not providing setup troubleshooting for third-party environments.

## Data Source

Hosted PMTiles dataset:

[https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles](https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles)

Direct PMTiles currently used by the app:

[https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles/resolve/main/gebco-2025-rawrgb-z0-6-webp.pmtiles](https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles/resolve/main/gebco-2025-rawrgb-z0-6-webp.pmtiles)

Data provenance note:

Current bathymetry content is derived from GEBCO sources, and visual styling is inspired by EMODnet bathymetry colour approaches.

## Important Warning

NOT FOR NAVIGATION.

This project and dataset are NOT intended for navigation, route planning, marine operations, legal compliance, or any safety-critical use.

This project is intended for visualisation, exploration, and scientific or educational research workflows.

All data and software are provided "as is" and without warranties of any kind, express or implied, including accuracy, completeness, timeliness, merchantability, or fitness for a particular purpose.

You are responsible for how you use this data and this software.

No endorsement is implied by GEBCO, EMODnet, CARTO, EOX, s2maps.eu, MapLibre, or Hugging Face.

## Credits And Attribution

- GEBCO for bathymetry data foundations.
- EMODnet for inspiration in approach and colour styling ideas.
- CARTO for basemap and label raster tiles.
- EOX and s2maps.eu for Sentinel-2 cloudless satellite base imagery.
- MapLibre GL JS for web map rendering.
- PMTiles for cloud-optimized single-file tiled data delivery.

Useful links:

- [https://www.gebco.net/](https://www.gebco.net/)
- [https://emodnet.ec.europa.eu/](https://emodnet.ec.europa.eu/)
- [https://carto.com/attributions](https://carto.com/attributions)
- [https://s2maps.eu/](https://s2maps.eu/)
- [https://tiles.maps.eox.at/](https://tiles.maps.eox.at/)
- [https://maplibre.org/](https://maplibre.org/)
- [https://protomaps.com/docs/pmtiles/](https://protomaps.com/docs/pmtiles/)

## Project Files

- [docs/index.html](docs/index.html): page structure and UI controls.
- [docs/app.js](docs/app.js): map logic, PMTiles loading, recolouring, and depth sampling.
- [docs/app.css](docs/app.css): map and panel styling.
- [docs/styles.json](docs/styles.json): palette metadata and base style definition.
