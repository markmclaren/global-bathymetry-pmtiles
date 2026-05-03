# Local Development with Docker Compose

This setup allows you to run the Global Bathymetry Explorer locally, serving both the frontend and the PMTiles files using Nginx. Nginx is configured to support HTTP Range Requests, which are required for PMTiles.

## Prerequisites

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Setup Instructions

1.  **Prepare the PMTiles file**:
    Place your `.pmtiles` file(s) in the `local/data/` directory.
    
    The local environment is configured to support both the original **2025** dataset and the newer **2026** terrain-rgb dataset. You can use either of these filenames:
    - `gebco-2025-rawrgb-z0-6-webp.pmtiles`
    - `gebco_2026_terrain_rgb.pmtiles`
    
    The Nginx configuration automatically handles the mapping so the explorer works without code changes.

2.  **Start the local server**:
    From the root of the repository, run:
    ```bash
    cd local
    docker-compose up -d
    ```

3.  **Access the application**:
    Open your browser and navigate to:
    [http://localhost:8080](http://localhost:8080)

## How it works

- **Frontend**: The `docs/` folder is mounted to the Nginx container and served at the root `/`.
- **PMTiles**: The `local/data/` folder is mounted to `/data/` in the container.
- **Dynamic URL Replacement**: Nginx uses `sub_filter` to automatically replace any Hugging Face URLs in the frontend code with local paths (`/data/...`) on the fly. This allows the same code to work both in production (Hugging Face) and locally without manual changes.
- **Range Requests**: Nginx is configured to support byte-range requests, enabling efficient streaming of PMTiles data.
