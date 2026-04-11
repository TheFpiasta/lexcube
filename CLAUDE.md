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

`npm run build` chains: `build:client` → `build:lib` → `build:nbextension` → `build:labextension`. The `build:client` step compiles `src/lexcube-client/` into its own `dist/` first.

**Stale build gotcha:** The Hatch wheel hook uses `skip-if-exists` and won't rebuild if `lexcube/nbextension/index.js` and `lexcube/labextension/package.json` already exist. Delete those files (or run `npm run build:prod` manually) if TS changes aren't reflected after a `pip install -e .`.

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

### Standalone Mode

The tile server can also run as a standalone HTTP/WebSocket server (not just as a Jupyter widget). In this mode, `socket.io-client` is used on the frontend instead of IPyWidgets messaging, and the server is started via `lexcube/lexcube_server/src/server.py`. The widget bridge (`src/widget.ts`) switches between widget and standalone messaging based on the URL hash.

### Message Protocol

Tile requests are batched: the client sends `{ indexDimension, indexValue, lod, xys: [[x, y], ...] }` grouping multiple XY tile coordinates into one message. The server responds with `{ response_type: "tile_data", metadata, dataSizes: [...], data: <binary> }`. The binary payload packs tiles back-to-back.

Key constants: `API_VERSION = 5`, `TILE_VERSION = 2`, magic bytes `"lexc"`. A `NAN_TILE_MAGIC_NUMBER = -1` in the metadata signals an all-NaN tile (no data payload); `LOSSLESS_TILE_MAGIC_NUMBER = -2` signals Blosc instead of ZFP compression.

### Web Worker / GeoJSON

GeoJSON parsing runs in a dedicated Web Worker (`geojson-loader.worker.ts`) via **Comlink** (RPC over `postMessage`). The rendering thread holds a `wrap<GeoJSONWorkerApi>(worker)` proxy and calls it with `await`. This is the only place the worker pattern is used; all other heavy work runs on the main thread.

### numcodecs.js (WebAssembly Dependency)

The decompression library is **not from the npm registry**. It is bundled as a local tarball at `src/lexcube-client/deps/numcodecs-0.2.5.tgz` and referenced in `src/lexcube-client/package.json`. If it needs updating, replace the tarball and update the version string manually.

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
