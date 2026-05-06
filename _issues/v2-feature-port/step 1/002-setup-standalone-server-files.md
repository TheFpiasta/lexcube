# 002 — Add Standalone Server Infrastructure Files

**Step**: 1 — Setup
**Type**: Setup
**Priority**: High
**Branch**: `feature-port-to-v2`
**Effort**: Easy

## Goal

Add the supporting files needed for the standalone web server. After this, the file infrastructure is in place for the standalone server feature (issue 007).

## What To Do

- Copy 3 GeoJSON files from `merge-v2` to `lexcube/lexcube_server/src/geojson/`:
    - `ne_10m_admin_0_countries.geojson`
    - `ne_50m_admin_0_countries.geojson`
    - `ne_110m_admin_0_countries.geojson`
- Create `lexcube/lexcube_server/requirements-standalone.txt` (fastapi, uvicorn, python-socketio, zfpy)
- Create `lexcube/lexcube_server/config_example.json` adapted for V2's schema:
    - All fields from `ServerConfig.read_from_config_file()` and `DatasetConfig.__init__()`
    - V2-specific: `target3dTileFormats`, `preGenerationSparsity2dTiles`, tile cache directory
    - Caching fields: `enabledCachingStrategies`, `maxCacheGb` (for issue 005)
    - 1-2 example dataset entries
- Update `.gitignore` if needed for standalone server configs/data

## Files Changed

- `lexcube/lexcube_server/src/geojson/*.geojson` (3 new files)
- `lexcube/lexcube_server/requirements-standalone.txt` (new)
- `lexcube/lexcube_server/config_example.json` (new)
- `.gitignore` (if needed)

## Acceptance

- 3 valid GeoJSON files in `lexcube/lexcube_server/src/geojson/`
- `requirements-standalone.txt` contains fastapi, uvicorn, python-socketio
- `config_example.json` is valid JSON and parseable by `ServerConfig.read_from_config_file()`

## Reference

- GeoJSON source: `merge-v2:lexcube/lexcube_server/src/geojson/`
- Requirements source: `merge-v2:lexcube/lexcube_server/requirements-standalone.txt`
- Config source: `merge-v2:lexcube/lexcube_server/config_example.json`
- V2 ServerConfig: `main:tile_server.py:1065-1100`
- V2 DatasetConfig: `main:tile_server.py:597-618`
