# Global Bathymetry Explorer: Interactive 3D Seafloor Visualization

An advanced, browser-based exploration tool for global seafloor topography, featuring dynamic recoloring, 3D terrain exploration, and high-performance data streaming.

**Live Map:** [https://markmclaren.github.io/global-bathymetry-pmtiles/](https://markmclaren.github.io/global-bathymetry-pmtiles/)  
**Dataset (PMTiles):** [https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles](https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles)

## Key Features

- **Dynamic 2D & 3D Visualization**: Toggle between a high-performance 2D map and an immersive 3D terrain view with globe projection.
- **Real-time Palette Switching**: Unlike standard raster maps, this viewer uses Raw RGB depth encoding to apply scientific color palettes (EMODnet, GEBCO, cmocean) on-the-fly in the browser.
- **Vertical Exaggeration Control**: Dynamically scale the topography of the seafloor (1x to 50x) to reveal submarine ridges, trenches, and undulations.
- **Interactive Depth Sampling**: Click anywhere on the globe to get precise elevation and depth measurements relative to sea level.
- **Integrated Land Themes**: Seamlessly switch between Dark, Light, and Satellite land modes with synchronized labels and boundaries.

## Technical Architecture

This project demonstrates a modern, serverless approach to hosting massive geospatial datasets:

- **Data Encoding**: Global GEBCO bathymetry is processed into a specialized **Raw RGB** raster format. Each pixel stores lossless depth data, allowing the client to handle the visual representation.
- **Cloud-Optimized Delivery**: The entire global dataset is stored in a single **PMTiles** archive hosted on Hugging Face. The browser uses HTTP Range Requests to fetch only the data needed for the current viewport, eliminating the need for a dedicated tile server.
- **Client-Side Rendering**: Built with **MapLibre GL JS**, utilizing custom protocols to perform per-pixel recoloring and terrain extrusion directly on the user's GPU.

## Project Status

This is an active research project. Current tiles prioritize a compact global dataset (Zoom 0-6), with higher resolution datasets and improved processing pipelines in development.

## Data Provenance

- **Bathymetry Source**: [GEBCO](https://www.gebco.net/)
- **Visual Inspiration**: [EMODnet Bathymetry](https://emodnet.ec.europa.eu/)
- **Vector Basemaps**: [OpenFreeMap](https://openfreemap.org/)
- **Satellite Imagery**: [Sentinel-2 Cloudless by EOX](https://s2maps.eu/)

---

## Important Warning

**⚠️ NOT FOR NAVIGATION.**

This project and dataset are NOT intended for navigation, route planning, marine operations, legal compliance, or any safety-critical use. This project is intended for visualization, exploration, and scientific or educational research workflows.

All data and software are provided "as is" without warranties of any kind. You are responsible for how you use this data and software.

## Local Development

Instructions for running the explorer locally using Docker Compose can be found in the [local setup guide](local/README.md).

## Repository Layout

- [/docs](docs): Main 2D visualization and data protocols.
- [/docs/3d](docs/3d): Interactive 3D terrain and globe exploration.
- [/docs/worker](docs/worker): High-performance version utilizing Web Workers for tile processing.
- [styles.json](docs/styles.json): Centralized configuration for scientific palettes and map themes.
