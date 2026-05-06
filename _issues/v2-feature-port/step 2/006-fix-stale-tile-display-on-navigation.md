# 006 - Fix Stale Tile Data Display on Navigation

**Step**: 2 - Fixes
**Type**: Analysis + Bug Fix
**Priority**: High
**Branch**: `feature-port-to-v2`
**Effort**: High (analysis-heavy)

## Problem

When navigating the cube (pan, zoom, dimension change) and new tiles take a long time to compute (especially with external data sources), the old tile data remains visible for seconds or minutes. This causes users to analyze incorrect data - they see stale tiles from the previous view position while the new tiles are being generated.

### Feature Branch Fix (v1.0.4) - 3-Part Mechanism

Commit `e577a1e` ("fix 3D qube renders old/incorrect data when generation is running") implemented:

1. **Server signals slow fetch** - New `tile_request_info` socket.io event with `externalFetchRequired: true` sent by the backend when a tile needs external data (S3, HTTP). This event does NOT exist in V2.
2. **Client clears stale tiles** - `clearTilesForDownload()` (tiledata.ts:924) fills tile storage with `NOT_LOADED_REPLACEMENT_VALUE` (-99999.0), replacing old pixel data immediately.
3. **Shader renders checkerboard** - Fragment shader (rendering.ts:1444) detects the sentinel value and shows a checkerboard pattern instead of stale data or the colormap.

The trigger chain: server detects external fetch -> emits `tile_request_info` -> client calls `clearTilesForDownload()` -> shader shows checkerboard -> new tiles arrive -> shader shows real data.

### V2 Complication

V2 introduces:

- **3D voxel mode** with volume rendering (`rendering/volume-rendering.ts`)
- **Tile2D + Tile3D** split - two different tile pipelines
- **New tile storage service** (`services/tile-storage.ts`, 971 lines) with `FLOAT_NOT_LOADED_REPLACEMENT_VALUE` and `RGB_NOT_LOADED_ALPHA_VALUE` constants
- **Unstructured/partial cube shapes** - not just full cubes anymore

The stale data fix needs to be rethought for V2's architecture. Simply porting the v1 approach may not work because:

1. The rendering pipeline is decomposed into multiple modules
2. Volume rendering has its own loading state handling
3. Tile2D and Tile3D have different display reset paths
4. The tile storage service manages GPU+CPU state separately

## V2 Root Cause Analysis (confirmed)

V2's current tile display lifecycle on view change:

1. User pans/zooms/changes dimension -> `triggerTileDownloads()` (interaction.ts:5066)
2. Download tracking maps are cleared (`resetTileDownloadMapsForFace`)
3. New tile requests are sent
4. **BUT: the actual tile data in `tileStoragesFloat` is NOT cleared** - old pixel values remain in GPU memory
5. Old tiles remain visible until new tiles arrive and overwrite them

V2 has `clearTilesForDownload()` (tiledata.ts:924) which fills tile ranges with `NOT_LOADED_REPLACEMENT_VALUE` (shows checkerboard pattern) - but this is only called for external fetches (networking.ts:165), NOT during normal view changes.

**The fix**: Call `clearTilesForDownload()` (or equivalent) on view changes so changed tiles show the checkerboard/not-loaded pattern immediately instead of stale data.

## What To Do

**This is a high-level analysis task first, implementation second.**

### Phase 1: Analysis

- V2's `clearTilesForDownload()` exists and works for 2D tiles - verify it covers all changed tiles on view change
- Determine if V2's 3D voxel rendering (volume-rendering.ts) has the same stale data problem and how to reset 3D textures
- Tile2D uses `tileStoragesFloat` arrays -> cleared by filling with `NOT_LOADED_REPLACEMENT_VALUE`
- Tile3D uses separate 3D textures -> need to find equivalent reset mechanism
- Check if clearing on every small pan is too aggressive (performance - avoid clearing tiles that are still valid)
- Propose a V2-adapted solution that handles both 2D face rendering AND 3D voxel rendering

### Phase 2: Implementation (based on analysis)

- Implement the chosen approach
- Ensure it works for Tile2D (face views) and Tile3D (voxel mode)
- Verify: on view change, old data disappears immediately, new data appears when ready

## Files Involved

- `src/lexcube-client/src/client/tiledata.ts` - `clearTilesForDownload()` (line 924), `allocateTileStorages()` (line 702)
- `src/lexcube-client/src/client/interaction.ts` - `triggerTileDownloads()` (line 5066), `selectParameter()` (line 3949)
- `src/lexcube-client/src/client/rendering.ts` - fragment shader (line 1336) displays checkerboard for NOT_LOADED, `resetForNewParameter()` (line 1274)
- `src/lexcube-client/src/client/networking.ts` - `updateViewBlocks()` (line 211), `clearTilesForDownload()` call (line 165)
- `src/lexcube-client/src/client/rendering/volume-rendering.ts` - 3D voxel loading state (needs analysis)
- `src/lexcube-client/src/client/constants.ts` - `NOT_LOADED_REPLACEMENT_VALUE = -99999.0` (line 131)

## Acceptance

- On view change: old tile data is NOT visible (replaced by default/empty state)
- New tile data renders correctly when it arrives
- Works for both 2D face views and 3D voxel mode
- No visual flicker or artifacts during the transition

## Reference

- Feature branch fix: commit `e577a1e` (embedded in caching changes - interaction.ts, tiledata.ts)
- V2 tile storage: `main:services/tile-storage.ts` (NOT_LOADED constants, download tracking)
- V2 volume rendering: `main:rendering/volume-rendering.ts`
- V2 tile texture views: `main:rendering/tile-texture-views.ts`
- V2 constants: `FLOAT_NOT_LOADED_REPLACEMENT_VALUE`, `RGB_NOT_LOADED_ALPHA_VALUE`
