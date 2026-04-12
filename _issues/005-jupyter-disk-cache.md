## Plan (direct kwargs, explicit tileCacheDirectory)

Status: OPEN

1. Extend widget API

- Add kwargs to Cube3DWidget.**init**:
  enabledCachingStrategies=None, maxCacheGb=None, tileCacheDirectory=None

2. Wire through widget startup

- lexcube/lexcube_server/src/lexcube_widget.py: accept those args in
  start_tile_server_in_widget_mode(...) and forward to TileServer.startup_widget(...)

3. Validate + init disk cache in widget mode

- TileServer.startup_widget(...):
  - If enabledCachingStrategies set and non-empty:
    - Validate strategies with CACHE_STRATEGIES
    - Require maxCacheGb > 0 and tileCacheDirectory (explicit)
    - Initialize TileDiskStorage/TileDiskCache same as standalone
    - Ensure cache directory exists and apply dataset cache settings

4. Use disk cache in widget requests

- Ensure handle_tile_request_widget(...) follows tile -> block -> generate flow
  and writes to disk cache when enabled

5. Logging

- Add minimal log lines confirming widget disk cache enabled and hit/miss summary
