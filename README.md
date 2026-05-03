# Global Bathymetry Explorer: Interactive 3D Seafloor Visualization

A browser-based tool for exploring global seafloor topography in 2D and 3D,
built over a weekend as part of a visualisation project about Caribbean Mermaids.
It started as an experiment in web-native geospatial mapping and turned into
something genuinely useful: a fully serverless, high-performance bathymetry
viewer that anyone can run without installing anything.

**Live Map:** https://markmclaren.github.io/global-bathymetry-pmtiles/  
**Dataset (PMTiles):** https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles

## Key Features

- **Dynamic 2D & 3D Visualization**: Toggle between a high-performance 2D map
  and an immersive 3D terrain view with globe projection.
- **Real-time Palette Switching**: Uses Raw RGB depth encoding to apply
  scientific colour palettes (EMODnet, GEBCO, cmocean) on-the-fly in the
  browser, without re-fetching data.
- **Vertical Exaggeration Control**: Scale seafloor topography from 1× to 50×
  to reveal submarine ridges, trenches, and undulations.
- **Interactive Depth Sampling**: Click anywhere on the globe for precise
  elevation and depth measurements relative to sea level.
- **Integrated Land Themes**: Switch between Dark, Light, and Satellite land
  modes with synchronised labels and boundaries.

## Technical Architecture

This project demonstrates a modern, serverless approach to hosting massive
geospatial datasets:

- **Data Encoding**: Global GEBCO bathymetry is processed into a **Raw RGB**
  raster format. Each pixel stores lossless depth data, so the client handles
  all visual representation — no server-side rendering required.
- **Cloud-Optimized Delivery**: The entire global dataset lives in a single
  **PMTiles** archive hosted on Hugging Face. The browser uses HTTP Range
  Requests to fetch only the tiles needed for the current viewport, eliminating
  the need for a dedicated tile server.
- **Client-Side Rendering**: Built with **MapLibre GL JS**, using custom
  protocols to perform per-pixel recoloring and terrain extrusion directly on
  the user's GPU.

## Data & Visual Attribution

**Bathymetric Data**

Two GEBCO grid releases are used in this project:

- GEBCO Compilation Group (2025) GEBCO 2025 Grid
  (doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29) — smaller regional file
- GEBCO Bathymetric Compilation Group (2026) GEBCO 2026 Grid
  (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa) — global file

The GEBCO Grid is placed in the public domain. This project does not claim
any official status and is not endorsed by GEBCO, the IHO, or the IOC.

**Colour Palettes**

The `rainbowcolour`, `multicolour`, and `atlas_land` colour schemes are
reproduced from [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry)
(European Marine Observation and Data Network). These palettes are used here
for scientific visualisation purposes; this project is not affiliated with or
endorsed by EMODnet.

**Vector Basemaps**: [OpenFreeMap](https://openfreemap.org/)  
**Satellite Imagery**: [Sentinel-2 Cloudless by EOX](https://s2maps.eu/)

---

## Important Warning

**⚠️ NOT FOR NAVIGATION.**

This project and dataset are not intended for navigation, route planning,
marine operations, legal compliance, or any safety-critical purpose. They are
intended for visualisation, exploration, education, and research only.

All data and software are provided "as is" without warranty of any kind.
You are solely responsible for how you use this data and software.

---

## Local Development

Instructions for running the explorer locally using Docker Compose can be
found in the [local setup guide](local/README.md).

## Repository Layout

[/docs](docs): Main 2D visualization and data protocols.  
[/docs/3d](docs/3d): Interactive 3D terrain and globe exploration.  
[/docs/worker](docs/worker): High-performance version utilizing Web Workers for tile processing.  
[styles.json](docs/styles.json): Centralized configuration for scientific palettes and map themes.
