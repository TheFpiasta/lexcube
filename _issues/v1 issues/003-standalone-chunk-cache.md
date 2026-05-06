# Issue 3: Enable chunk caching in standalone server

Status: REJECTED

## Context

Widget mode uses `DataSourceProxy` and `dask.cache` to reuse chunks. Standalone mode does not, so identical chunks are re-downloaded from the remote store on repeated requests.

## Goal

Standalone mode uses the same chunk cache strategy as widget mode to reduce remote reads. This should complement the tile/block caching strategies without changing request/response behavior.

## Scope

- `lexcube/lexcube_server/src/tile_server.py`: standalone startup/live path.
- Enable `dask.cache.Cache`.
- Use `DataSourceProxy` for chunked reads.

## Out of scope

- New config knobs for cache size in this issue.
- Tile format changes.

## Implementation notes

- Create and register a `Cache` instance at standalone startup (same as widget mode).
- Use `DataSourceProxy` during tile generation when the source data is chunked.
- Extend `is_chunk_caching_enabled()` if needed (currently widget-specific).

## Acceptance criteria

- Repeated tile requests for the same region fetch fewer remote chunks (measurable via timing or network).
- No behavior changes in widget mode.
- No request/response protocol changes.
- Works alongside tile/block disk caches without changing their behavior.

## Risks/Notes

- Cache size may need to be configurable later if memory use is high.

## Tests

- Manual: open a remote Zarr, request the same tiles multiple times, latency should drop.
