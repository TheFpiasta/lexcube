# Issue 6: Immediate cancel during tile download

Status: OPEN

## Context

Standalone and widget tile generation only check cancel flags between tiles. A single tile can take a long time to generate when the data source is remote, so cancellation is delayed until the next tile. The long-running step is the implicit data read when slicing the dataset inside `Tile.generate_from_data`.

## Findings

- Tile generation reads data via `source_data[z_slice, y_slice, x_slice]` in `lexcube/lexcube_server/src/tile_server.py` (class `Tile`).
- The actual download is handled by `xarray` + `fsspec` when the dataset is remote (S3/HTTP). There is no explicit download function to interrupt.
- Current cancel flags are only checked between tiles and in background pause loops, not inside the data read step.
- If the dataset is chunked, cancellation could be checked between chunk reads in `DataSourceProxy`.
- If the dataset is unchunked, a single blocking read cannot be interrupted inside the same process/thread.
- The only reliable immediate cancellation for unchunked/blocked reads is to run tile generation in a separate process and terminate it on cancel (process isolation).

## Goal

Cancel tile generation quickly (near-immediate) even when a single tile download is slow.

## Scope

- Foreground and background tile generation in `lexcube/lexcube_server/src/tile_server.py`.
- Tile data access in `Tile.generate_from_data` and `DataSourceProxy`.

## Out of scope

- Request/response protocol changes.
- UI changes.

## Options

### Option A: Chunk-aware cooperative cancel

- Require chunked datasets (zarr or xarray opened with `chunks=`).
- Add cancel checks between chunk reads in `DataSourceProxy.__getitem__`.
- Add cancel checks between major steps in `Tile.generate_from_data`.
- Limitation: cannot interrupt a single blocking read or native call.

### Option B: Process isolation per tile

- Run tile generation in a worker process.
- Kill the worker immediately on cancel.
- Works even when the download is a single blocking read.
- Tradeoff: higher overhead and more process management complexity.

## Acceptance criteria

- Cancellation stops long-running tile downloads within a short time window.
- Foreground and background cancellation logs still fire as expected.
- No cache writes or partial data are produced for canceled tiles.

## Risks/Notes

- If chunking is not guaranteed, Option A is not sufficient for immediate cancellation.
- Option B adds process lifecycle complexity and potential overhead.

## Tests

- Manual: trigger a long-running tile download, cancel immediately, confirm it stops quickly and no data is emitted.
