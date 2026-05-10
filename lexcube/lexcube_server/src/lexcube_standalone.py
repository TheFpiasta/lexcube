"""
Standalone web server for Lexcube V2.

Serves the REST metadata API and socket.io tile stream on port 5000.
The webpack dev client (src/lexcube-client, port 8080) connects here.

Usage (from project root, with config.json present in current directory):
    python lexcube/lexcube_server/src/lexcube_standalone.py

config.json is read from the current working directory. Copy and edit
lexcube/lexcube_server/config_example.json to get started.
"""

import logging
import os
import signal
import threading
import time
import traceback
import urllib.request
from pathlib import Path

import socketio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from lexcube.lexcube_server.src.tile_server import TileServer, API_VERSION

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("lexcube")

GEOJSON_DIR = Path(__file__).parent / "geojson"
GEOJSON_DIR.mkdir(exist_ok=True)
GEOJSON_FILES = {
    "ne_110m_admin_0_countries.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    "ne_50m_admin_0_countries.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
    "ne_10m_admin_0_countries.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
}
GEOJSON_DOWNLOAD_TIMEOUT_SECONDS = 60


def download_geojson_files():
    GEOJSON_DIR.mkdir(exist_ok=True)
    for filename, url in GEOJSON_FILES.items():
        dest = GEOJSON_DIR / filename
        if dest.exists():
            continue
        try:
            logger.info("Downloading %s ...", filename)
            with urllib.request.urlopen(url, timeout=GEOJSON_DOWNLOAD_TIMEOUT_SECONDS) as response:
                dest.write_bytes(response.read())
            logger.info("  -> saved to %s", dest)
        except Exception:
            logger.warning(
                "Failed to download %s - country borders unavailable at this resolution. "
                "You can manually place the file in %s",
                filename, GEOJSON_DIR,
            )
            if dest.exists():
                dest.unlink()


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
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
    try:
        return {"status": "ok", "api_version": API_VERSION}
    except Exception as e:
        logger.error("Error in /api: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/datasets")
async def api_datasets():
    try:
        return [d.get_minimal_representation() for d in tile_server.datasets.values()]
    except Exception as e:
        logger.error("Error in /api/datasets: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/datasets/{dataset_id}")
async def api_dataset(dataset_id: str):
    try:
        dataset = tile_server.datasets.get(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
        return dataset.get_detailed_representation()
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in /api/datasets/%s: %s\n%s", dataset_id, e, traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@sio.on("request_tile_data")
async def handle_request_tile_data(sid, data):
    try:
        await tile_server.handle_tile_request_standalone(sio, sid, data)
    except Exception as e:
        logger.error("Error in request_tile_data (sid=%s): %s\n%s", sid, e, traceback.format_exc())


@sio.on("request_tile_data_multiple")
async def handle_request_tile_data_multiple(sid, data):
    try:
        for request_data in data:
            await tile_server.handle_tile_request_standalone(sio, sid, request_data)
    except Exception as e:
        logger.error("Error in request_tile_data_multiple (sid=%s): %s\n%s", sid, e, traceback.format_exc())


@sio.on("request_event_data")
async def handle_request_event_data(sid, data):
    try:
        await tile_server.handle_event_request_standalone(sio, sid, data)
    except Exception as e:
        logger.error("Error in request_event_data (sid=%s): %s\n%s", sid, e, traceback.format_exc())


# Mount AFTER API routes so /api/* is matched first
app.mount("/", StaticFiles(directory=str(GEOJSON_DIR)), name="geojson")

socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="ws/socket.io")

if __name__ == "__main__":
    download_geojson_files()
    tile_server.startup_standalone()

    config = uvicorn.Config(socket_app, host="0.0.0.0", port=5000, log_level="info")
    server = uvicorn.Server(config)
    server.install_signal_handlers = False

    def handle_shutdown(signum, frame):
        logger.info("Shutdown requested (signal %s), stopping server...", signum)
        server.should_exit = True
        os._exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_shutdown)

    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    while True:
        time.sleep(1)
