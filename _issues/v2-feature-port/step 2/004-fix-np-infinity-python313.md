# 004 — Fix np.Infinity for Python 3.13+ Compatibility

**Step**: 2 — Fixes
**Type**: Bug Fix
**Priority**: High
**Branch**: `feature-port-to-v2`
**Effort**: Trivial

## Problem

`tile_server.py` uses `np.Infinity` (lines 788-789) which is removed in Python 3.13+.

## Solution

Replace all `np.Infinity` / `np.Inf` with `np.inf` in `lexcube/`. Only literal replacement, no logic changes.

## Files Changed

- `lexcube/lexcube_server/src/tile_server.py`

## Acceptance

- `grep -rn "np\.Infinity\|np\.Inf[^i]" lexcube/` returns 0 matches
- Module imports cleanly on Python 3.13+

## Reference

- Feature branch commit: `d4ed7fd`
