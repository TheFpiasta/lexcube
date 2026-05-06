# 001 — Adjust SETUP.md for V2

**Step**: 1 — Setup
**Type**: Setup / Documentation
**Priority**: High
**Branch**: `feature-port-to-v2` (create from `main` if not existing)
**Effort**: Moderate

## Goal

Clone SETUP.md from feature branch and adjust for V2. After this, a developer can follow the guide to build and run the project on V2.

## What To Do

- Create branch `feature-port-to-v2` from `main` (first issue — branch must exist)
- Clone `SETUP.md` from `merge-v2` branch
- Adjust all build commands for V2:
    - Webpack → Vite (`npm run dev` uses Vite, `npm run build` uses `vite build`)
    - TypeScript 4.9 → 5.9, Three.js 0.144 → 0.182
    - numcodecs 0.2.5 → 0.2.8
- Adjust Python instructions for V2 deps (zarr 3.x, numpy 2.4.x)
- Add standalone server section (reference issues 002-007)
- Remove any webpack/v1-specific instructions

## Files Changed

- `SETUP.md` (new — cloned + adjusted from `merge-v2:SETUP.md`)

## Acceptance

- Branch `feature-port-to-v2` exists
- `SETUP.md` exists with no webpack references
- Contains: Prerequisites, Python setup, Client build (Vite), Jupyter dev, Standalone server, Windows notes

## Reference

- Source: `merge-v2:SETUP.md` (225 lines)
- V2 build: `main:src/lexcube-client/package.json` (`"dev": "vite"`, `"build": "vite build"`)
- V2 Python: `main:pyproject.toml`, `main:lexcube/lexcube_server/requirements-core.txt`
