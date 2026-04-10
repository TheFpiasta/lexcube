"""
Standalone web server for Lexcube.

Serves the REST metadata API and socket.io tile stream on port 5000.
The webpack dev client (src/lexcube-client, port 8080) connects here.

Usage (from project root, with config.json present in current directory):
    python lexcube/lexcube_server/src/lexcube_standalone.py

config.json is read from the current working directory. Copy and edit
lexcube/lexcube_server/config_example.json to get started.
"""

import urllib.request
from pathlib import Path

import socketio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from lexcube.lexcube_server.src.tile_server import TileServer, API_VERSION

# Natural Earth country boundary GeoJSON files served at /ne_*m_admin_0_countries.geojson
# The client (rendering.ts) fetches these to draw country borders on the 3D cube.
GEOJSON_DIR = Path(__file__).parent / "geojson"
GEOJSON_DIR.mkdir(exist_ok=True)  # must exist before StaticFiles mount below
GEOJSON_FILES = {
    "ne_110m_admin_0_countries.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    "ne_50m_admin_0_countries.geojson":  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
    "ne_10m_admin_0_countries.geojson":  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
}


def download_geojson_files():
    GEOJSON_DIR.mkdir(exist_ok=True)
    for filename, url in GEOJSON_FILES.items():
        dest = GEOJSON_DIR / filename
        if not dest.exists():
            print(f"Downloading {filename} ...", flush=True)
            urllib.request.urlretrieve(url, dest)
            print(f"  -> saved to {dest}", flush=True)


sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
tile_server = TileServer(widget_mode=False)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
async def api_status():
    return {"status": "ok", "api_version": API_VERSION}


@app.get("/api/datasets")
async def api_datasets():
    return [d.get_minimal_representation() for d in tile_server.datasets.values()]


@app.get("/api/datasets/{dataset_id}")
async def api_dataset(dataset_id: str):
    dataset = tile_server.datasets.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return dataset.get_detailed_representation()


@sio.on("request_tile_data")
async def handle_request_tile_data(sid, data):
    await tile_server.handle_tile_request_standalone(sio, sid, data)


@sio.on("cancel_tile_requests")
async def handle_cancel_tile_requests(sid, data):
    await tile_server.handle_cancel_tile_requests(data)


# Serve Natural Earth GeoJSON files at the root path (e.g. /ne_110m_admin_0_countries.geojson).
# This mount must come AFTER the API routes so that /api/* routes are matched first.
app.mount("/", StaticFiles(directory=str(GEOJSON_DIR)), name="geojson")

# Wraps FastAPI with socket.io served at /ws/socket.io/ (matches networking.ts:60)
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path='ws/socket.io')

if __name__ == "__main__":
    download_geojson_files()
    tile_server.startup_standalone()
    uvicorn.run(socket_app, host="0.0.0.0", port=5000)
