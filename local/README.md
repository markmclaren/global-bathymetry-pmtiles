# Local Development with Docker Compose

This setup allows you to run the Global Bathymetry Explorer locally, serving both the frontend and the PMTiles files using Nginx. Nginx is configured to support HTTP Range Requests, which are required by the explorer.

## Prerequisites

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Setup Instructions

1.  **Prepare the PMTiles file**:
    Place your `.pmtiles` file(s) in the `local/data/` directory.

    You can download a small test file (**2025 data**, zoom levels 0–6, approx. 200 MB) or a larger file (**2026 data**, zoom levels 0–10, approx. 6 GB) for testing from:  
    [https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles](https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles)

    The local environment is configured to use the **2026** terrain-rgb dataset by default:
    - `gebco_2026_terrain_rgb.pmtiles`

    If you use the smaller test file (`gebco_2025_terrain_rgb.pmtiles`), update the explorer configuration as needed or rename the file to match the default.

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
- **Dynamic URL Replacement**: Nginx uses `sub_filter` to automatically replace any Hugging Face URLs in the frontend code with local paths (`/data/...`) on the fly. This allows the same code to work locally as it does when deployed.
- **Range Requests**: Nginx is configured to support byte-range requests, enabling efficient streaming of PMTiles data.