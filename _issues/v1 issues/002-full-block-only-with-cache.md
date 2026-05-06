# Issue 2: Tile-first caching + background full-block with strict prioritization

Status: DONE

## Context

When caching is enabled, we want fast responses for requested tiles while still building a full block for future hits. Full-block generation must not delay or starve tile requests. Tiles should be cached on disk so repeated requests avoid re-fetching.

## Goal

Implement a two-tier caching strategy:

1. Tile cache on disk (new)
2. Block cache on disk (existing)
   with tile-first responses and low-priority background full-block generation that never blocks foreground requests.

## Scope

- `lexcube/lexcube_server/src/tile_server.py`: request handling, cache lookup order, background block generation, priority scheduling.
- Add config field `enabledCachingStrategies: ["tile", "block"]`.
- Disk-backed tile cache (separate from block cache).

## Behavior (caching enabled)

1. Always generate/request needed tiles first
   - Requested tiles are generated immediately and sent to the client.
   - Foreground path never generates full-blocks; only requested tiles for the requested lod.
2. Tile cache (disk)
   - Store each generated tile on disk for reuse.
3. Background full-block generation
   - Starts only after the client response is sent.
   - Pauses only while there are active foreground tile requests.
   - Cancellation applies only to background block generation (tile generation is never canceled).
   - Must skip tiles already cached (no re-download).
   - Must run low priority and never block or slow down tile generation.
4. Request path priority
   - On new request:
     - Check tile cache first.
     - Then check block cache.
     - If miss, generate tiles immediately and respond.
     - Trigger background block generation if "block" is enabled.

## Config

- `enabledCachingStrategies: ["tile", "block"]`
  - "tile" enables disk tile cache.
  - "block" enables background full-block generation.
  - Both can be enabled together. Tile-first behavior is always enforced.

## Acceptance criteria

- Tile responses are immediate and not delayed by block generation.
- Tile requests always preempt background block generation.
- Cached tiles are served without re-fetching.
- Full-block generation skips already cached tiles.
- Config toggles work as specified.
- Foreground requests never trigger full-block generation; only requested tiles are generated and returned.

## Risks / Notes

- Priority scheduling must be enforced (foreground tile generation must always win).
- Block generation is best-effort; it may pause or be canceled when users move views.
- Disk tile cache needs a naming scheme compatible with current tile identity.

## Tests

- Manual: request tiles, verify immediate response and background block logs.
- Manual: repeat same tiles, verify disk tile cache hit and no remote fetch.
- Manual: run with ["tile"] only -> no block generation.
- Manual: run with ["block"] only -> still tile-first, block runs in background.
