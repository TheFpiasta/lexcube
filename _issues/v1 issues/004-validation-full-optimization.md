# Issue 4: Validate full optimization end-to-end

Status: DONE

## Context

After implementing the three optimizations, we must confirm that the live path pulls only necessary data, full-block generation is limited to caching, and chunk caching works in standalone mode.

## Goal

Prove all three optimizations are active together and show measurable impact.

## Scope

- Define test plan and measurement criteria.
- Manual verification in the web app (standalone) with a remote dataset.
- Document observed results.

## Out of scope

- Automated benchmarking infrastructure.
- Code changes beyond minimal logs for measurement.

## Validation setup

- Start standalone (FastAPI + Socket.IO).
- Use a remote Zarr dataset in `config.json`.
- Open browser and load a typical scene (3 active faces visible).

## Measurement criteria

1. Requested-only generation active
   - Each request generates only the requested tiles (no full-block logs).

2. Tile cache + background block cache
   - `enabledCachingStrategies=["tile"]`: tile cache hits, no block generation.
   - `enabledCachingStrategies=["block"]`: tile-first response, background block generation runs.
   - `enabledCachingStrategies=["tile", "block"]`: tile cache hits and background block generation both work.

3. Chunk caching active
   - Repeated requests for the same region are significantly faster.
   - Remote reads (or downloaded bytes) drop on repeated requests.

## Acceptance criteria

- All three points are verifiable in the same build/run.
- No protocol changes (client runs unchanged).
- Foreground tile responses are not delayed by background block generation.

## Documentation

- Short report with before/after timings and observations.
