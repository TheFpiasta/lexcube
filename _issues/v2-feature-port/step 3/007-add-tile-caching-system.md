# 007 - Add Tile Caching System

**Step**: 3 - Features
**Type**: Feature
**Priority**: High
**Branch**: `feature-port-to-v2`
**Effort**: High

## Goal

Add configurable tile caching as a core system for both Jupyter widget mode and standalone web mode. After this, tiles are cached on first generation and served from cache on revisit - no re-fetching data sources or re-computing.

## What To Do

### 1. Caching Configuration (`tile_server.py`)

- Add `CACHE_STRATEGIES = {"tile", "block"}` constant
- Extend `DatasetConfig` with: `enabledCachingStrategies` (list), `maxCacheGb` (float), `caching_enabled()`, `caching_strategy_enabled(strategy)`
- Validation: reject unknown strategies, require maxCacheGb > 0 when caching enabled

### 2. TileDiskCache Class (`tile_server.py`)

- Handles BOTH Tile2D and Tile3D (keep V2's separate classes - do NOT unify)
- Cache key includes tile_format (ZFP/BLOSC_LZ4/VLQ) - same tile at same LOD produces different bytes per format
- Methods: `tile_exists()`, `read_tile()`, `write_tile()`, `get_cache_size_bytes()`, `_can_write()`
- Atomic write: `.tmp` -> `os.rename()` (prevents corruption on crash/cancel)
- Disk full: try/except, log warning, continue without caching

### 3. Widget Mode Config Plumbing (`cube3d.py`, `lexcube_widget.py`)

- Add `Cube3DWidget` constructor params: `caching_mode` ("memory"/"disk"/"none", default "memory"), `cache_directory`, `max_cache_gb`
- Pass through to `TileServer` via `lexcube_widget.py`
- Backward compatible - existing code works unchanged

### 4. Integrate into Widget Handler (`tile_server.py`)

- Extend `handle_tile_request_widget()`:
    - "memory": current behavior (tile_memory_cache only)
    - "disk": memory cache -> disk cache -> generate -> write disk -> write memory -> serve
    - "none": generate every time

### 5. Integrate into Standalone Handler (`tile_server.py`)

- Extend `handle_tile_request_standalone()`:
    - Block file exists -> serve from block (preserve current behavior)
    - Block missing + caching -> check disk cache -> generate -> cache -> serve
    - Block missing + no caching -> graceful error

## Architecture Constraints

- **MUST** keep Tile2D and Tile3D as separate classes (V2 architecture)
- **MUST** use `current_output_tile_format: str` API (NOT `compress_lossless: bool`)
- **MUST NOT** implement cross-LOD cache derivation (never compute LOD N from cached LOD M - compounding lossy artifacts)
- **MUST NOT** implement standalone chunk caching (rejected in prior analysis)
- **MUST NOT** add LRU eviction (future improvement)
- **MUST NOT** copy merge-v2 code verbatim (incompatible Tile class hierarchy)

## Caching Modes

| Mode   | Widget (Jupyter)                           | Standalone (Web)                    |
| ------ | ------------------------------------------ | ----------------------------------- |
| memory | In-memory only (default, current behavior) | N/A                                 |
| disk   | Memory + disk persistence                  | Disk (default when caching enabled) |
| none   | No caching                                 | No caching (block files only)       |

## Files Changed

- `lexcube/lexcube_server/src/tile_server.py` (caching config, TileDiskCache, handler integration)
- `lexcube/cube3d.py` (constructor params)
- `lexcube/lexcube_server/src/lexcube_widget.py` (config pass-through)

## Acceptance

- Config: `enabledCachingStrategies: ["tile"]` + `maxCacheGb: 2.0` -> `caching_enabled() == True`
- Config: no caching fields -> `caching_enabled() == False` (backward compat)
- Config: invalid strategy -> `ValueError`
- Tile2D: write -> read roundtrip returns identical bytes
- Tile3D: write -> read roundtrip returns identical bytes
- Same tile + different tile_format -> different cache entries
- Widget default mode: existing behavior unchanged
- Widget disk mode: first request generates + caches, second request serves from cache
- Standalone: block exists -> served from block; block missing + cache -> generated + cached
- `Cube3DWidget(np.zeros((10,10,10)))` still works unchanged

## Reference

- V2 DatasetConfig: `main:tile_server.py:597-618`
- V2 Tile2D: `main:tile_server.py:1225-1270`
- V2 Tile3D: `main:tile_server.py:1423-1580`
- V2 TileGenerationCache: `main:tile_server.py:1583-1636`
- V2 widget handler: `main:tile_server.py:1796-1847`
- V2 standalone handler: `main:tile_server.py:1849-1888`
- V2 cube3d.py: `main:lexcube/cube3d.py`
- V2 lexcube_widget.py: `main:lexcube/lexcube_server/src/lexcube_widget.py`
- Feature branch caching: `merge-v2:tile_server.py:317-354, 818-880, 1426-1570` (design reference - incompatible types)
