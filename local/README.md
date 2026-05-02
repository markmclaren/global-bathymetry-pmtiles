# Local Development with Docker Compose

This setup allows you to run the Global Bathymetry PMTiles viewer locally, serving both the frontend and the PMTiles files using Nginx. Nginx is configured to support HTTP Range Requests, which are required for PMTiles.

## Prerequisites

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Setup Instructions

1.  **Prepare the PMTiles file**:
    Place your `.pmtiles` file(s) in the `local/data/` directory.
    
    The application currently expects the filename to be:
    `gebco-2025-rawrgb-z0-6-webp.pmtiles`
    
    If you use a different filename, you may need to update the references in `docs/app.js` or `docs/styles.json`, or simply ensure the filename matches what is expected.

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
