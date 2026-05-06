# 008 — Add Tile Request Cancellation

**Step**: 3 — Features
**Type**: Feature
**Priority**: Medium
**Branch**: `feature-port-to-v2`
**Effort**: Moderate

## Goal

Add tile request cancellation so the server stops generating tiles for a previous view when the user navigates. Prevents wasted CPU, especially with expensive 3D tile generation.

## What To Do

### Server-side (`tile_server.py`)

- Add cancel flags to `TileServer`: `_foreground_cancel_flag`, tracking methods
- Add `_foreground_request_started()` / `_foreground_request_finished()` / `_foreground_requests_active()`
- Add `handle_cancel_tile_requests(data)` async method
- Add `shutdown()` method for graceful cleanup
- Cancel pattern: after generating each tile in a batch, check flag → if set, stop and return partial results

### Client-side (`networking.ts` + `interaction.ts`)

- Add `cancelAllPendingTileRequests()` to Networking class
- Emit `cancel_tile_requests` socket.io event
- In `interaction.ts`: call cancel when view changes, before requesting new tiles

## Architecture Constraints

- Current mechanism only: finish generating current tile, THEN check flag
- **MUST NOT** implement immediate mid-computation abort (documented future improvement)
- **MUST NOT** change the `request_tile_data_multiple` event protocol

## Files Changed

- `lexcube/lexcube_server/src/tile_server.py`
- `src/lexcube-client/src/client/networking.ts`
- `src/lexcube-client/src/client/interaction.ts`

## Acceptance

- `TileServer` has `shutdown()`, `handle_cancel_tile_requests()`, `_foreground_requests_active()`
- `networking.ts` has `cancelAllPendingTileRequests()` that emits `cancel_tile_requests`
- `interaction.ts` triggers cancel on view changes
- TypeScript compiles without new errors

## Future Improvement (NOT this issue)

Immediate mid-computation abort — interrupt in-progress data fetch/tile generation when it becomes irrelevant.

## Reference

- Feature branch server: `merge-v2:tile_server.py:1227-1248, 1461-1480`
- Feature branch client: `merge-v2:networking.ts:100-130`
- V2 networking emit pattern: `main:networking.ts:279-283`
- V2 interaction.ts: find view-change trigger points for cancel insertion
