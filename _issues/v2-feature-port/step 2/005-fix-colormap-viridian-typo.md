# 005 — Fix Colormap Name "viridian" → "viridis"

**Step**: 2 — Fixes
**Type**: Bug Fix
**Priority**: Medium
**Branch**: `feature-port-to-v2`
**Effort**: Trivial

## Problem

`ui/colormap-ui.ts:289` has `"viridian"` (not a valid colormap). Should be `"viridis"`. Bug existed in v1 `interaction.ts` and migrated to V2's new `colormap-ui.ts` module.

## Solution

Replace `"viridian"` with `"viridis"`. Search all `.ts` files for other occurrences.

## Files Changed

- `src/lexcube-client/src/client/ui/colormap-ui.ts`

## Acceptance

- `grep -rn "viridian" src/lexcube-client/` returns 0 matches

## Reference

- Feature branch commit: `5ecc07e`
