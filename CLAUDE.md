# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lexcube is an interactive 3D data cube visualization Jupyter widget. It renders multidimensional geospatial arrays (NumPy, xarray, Zarr, NetCDF) as 3D cubes with pan/zoom/rotate interaction. It is a hybrid Python + TypeScript project using the IPyWidgets framework.

## Build System

There are two separate build surfaces:

**Root (Jupyter widget integration):**
```bash
npm run build:prod    # Production build (used by Hatch wheel hook)
npm run build         # Dev build
npm run watch         # Watch mode for TS + webpack
npm run lint          # ESLint with auto-fix
npm run lint:check    # ESLint check only
npm run test          # Jest tests
```

**3D client (`src/lexcube-client/`):**
```bash
cd src/lexcube-client
npm run build         # Webpack production build -> dist/
npm run dev           # Webpack dev server
```

**Python:**
```bash
pip install -e ".[test, examples]"   # Dev install (triggers TS build via Hatch hook)
pytest                               # Python tests
python -m build                      # Build wheel for release
```

## Development Setup

```bash
npm i
pip install jupyterlab
pip install -e ".[test, examples]"
jupyter labextension develop --overwrite .
npm run build
```

During active development run `npm run watch` in one terminal and `jupyter lab` in another. Python changes require a kernel restart; TS/JS changes auto-rebuild.

For classic notebook:
```bash
jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube
jupyter nbextension enable --sys-prefix --py lexcube
```

## Running Tests

```bash
# Single Python test
pytest lexcube/tests/test_example.py::test_example_creation_blank -v

# Single Jest test file
npm run test -- src/__tests__/index.spec.ts
```

## Architecture

### Component Interaction

```
User (Jupyter Notebook)
  -> Cube3DWidget (Python: lexcube/cube3d.py)
       IPyWidgets.DOMWidget subclass. Stores UI state (vmin/vmax, colormaps,
       camera angles, dim limits). Syncs with frontend via trait observation.
       |
       +-> TileServer (Python: lexcube/lexcube_server/src/tile_server.py)
       |    Runs in the same kernel process. Handles data access, chunking,
       |    and lossy ZFP compression of float32 tiles. Communicates via
       |    Widget.on_msg() callbacks.
       |
       +-> Frontend Widget (TypeScript: src/widget.ts)
            Routes messages between TileServer and the 3D client.
            |
            -> CubeClientContext (TypeScript: src/lexcube-client/src/client/client.ts)
                 Coordinates three subsystems:
                 - rendering.ts  : Three.js cube rendering, colormaps, GeoJSON overlays,
                                   screenshot/video export (html-to-image, mp4-muxer)
                 - interaction.ts: Mouse/touch pan/zoom/rotate, custom OrbitControls,
                                   noUiSlider dimension navigation, xlim/ylim/zlim
                 - tiledata.ts   : Receives compressed tiles, decompresses via
                                   numcodecs.js (WebAssembly), caches, maps to textures
```

### Data Flow

1. User creates `Cube3DWidget(data, cmap=..., vmin=..., vmax=...)`
2. TileServer starts in widget mode, reads metadata, exposes data via DataSourceProxy
3. 3D client requests tiles at LOD 0 (lowest resolution)
4. As the user rotates/zooms, the client calculates visible tiles and requests them
5. TileServer reads data chunks, compresses with ZFP, sends back
6. Frontend decompresses (WebAssembly), updates Three.js textures

### Key Files

| File | Role |
|------|------|
| `lexcube/cube3d.py` | Main Python widget class and user-facing API |
| `lexcube/lexcube_server/src/tile_server.py` | Core tile generation, ZFP compression, data access |
| `lexcube/lexcube_server/src/lexcube_widget.py` | Widget mode init and message routing |
| `src/widget.ts` | Jupyter widget frontend bridge |
| `src/lexcube-client/src/client/client.ts` | 3D client entry point |
| `src/lexcube-client/src/client/rendering.ts` | Three.js rendering (largest file) |
| `src/lexcube-client/src/client/interaction.ts` | All user interaction logic (largest file) |
| `src/lexcube-client/src/client/tiledata.ts` | Tile decompression and texture caching |

### Dimension Convention

The 3D cube always maps: Z = axis[0], Y = axis[1], X = axis[2]. Users must transpose input arrays if the desired orientation differs.

### Colormap Range Default

Auto-calculated as mean ±2.5σ (not true min/max) to filter outliers.

## Release

```bash
tbump <new-version>   # Bumps version across pyproject.toml, _version.py, package.json; creates git tag
npm run build:prod
python -m build
python -m twine upload --repository pypi dist/lexcube-*
npm publish
```
