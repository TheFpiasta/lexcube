# Components: Tile Server

The tile server provides dataset discovery, tile generation, compression, and caching for both standalone and widget modes. It runs in-process for widget mode and as a WebSocket backend for standalone mode.

Key modules

- `lexcube/lexcube_server/src/tile_server.py` (core server, datasets, tiling, caching).
- `lexcube/lexcube_server/src/lexcube_widget.py` (widget bridge).
- `lexcube/lexcube_server/config_example.json` (configuration schema example).

Core components

- `TileServer`
  - Manages datasets, tile size, compression, request tracking, and cache policy.
  - `startup_widget`: in-process mode, uses memory cache and optional chunk caching.
  - `startup_standalone`: reads `config.json`, opens datasets, builds indices, prepares disk cache.
  - `handle_tile_request_widget`: generates tiles and returns data buffers to widget.
  - `handle_tile_request_standalone`: serves tiles to WebSocket clients (disk or generated).

- Dataset management
  - `DatasetConfig` and `ServerConfig` parse `config.json` and normalize legacy keys.
  - `Dataset` handles dataset opening (Zarr/NetCDF), metadata loading, parameter discovery, and LOD limits.
  - `DatasetMetadata` provides dimension names, labels, and coordinate metadata.

- Tiling and storage
  - `Tile` encodes tile identity (dataset, parameter, dimension, index, LOD, XY).
  - `TileDiskStorage` stores tiles per dataset/parameter/dimension/index with block files.
  - `TileMemoryCache` caches tiles in widget mode.
  - `BlockFile` groups tiles per index value for efficient read.

- Compression and data handling
  - `TileCompressor` selects lossy (ZFP) or lossless (Blosc/LZ4) compression.
  - Widget mode defaults to lossless (`compress_lossless = True`).
  - Tile format uses magic bytes and versioning (`TILE_FORMAT_MAGIC_BYTES`, `TILE_VERSION`).
  - Metadata discovery (min/max, quantiles, resolution) uses multiprocessing.

Standalone configuration (high level)

- `datasetBaseDir`, `tileCacheDir`, `preGenerationThreads`.
- Dataset entries include `datasetPath`, `onlyParameters`, `ignoredParameters`, `preGenerationSparsity`, `overrideMaxLod`, `useOfflineMetadata`.

Notes

- The Dockerfile in `lexcube/lexcube_server/Dockerfile` references `src/lexcube_standalone.py`. That file is not present in this repo snapshot, so the HTTP/WebSocket entrypoint is assumed to exist outside this tree or in a different branch.
