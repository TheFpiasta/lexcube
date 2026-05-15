# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Shape

Lexcube is a hybrid Python + Jupyter widget + TypeScript frontend for 3D data cube visualization. Most changes touch multiple layers:

- `lexcube/` - Python package: ipywidget (`cube3d.py`), Jupyter lab/nbextension hooks (`__init__.py`), and the tile server (`lexcube_server/`).
- `lexcube/lexcube_server/src/tile_server.py` - core tile-generation engine used by both widget and standalone modes.
- `lexcube/lexcube_server/src/lexcube_widget.py` - bridges `TileServer` into the Jupyter widget runtime.
- `lexcube/lexcube_server/src/lexcube_standalone.py` - FastAPI + socket.io server for browser-only standalone mode (port 5000).
- `src/` - TypeScript widget bridge between ipywidgets and the client (`widget.ts`, `plugin.ts`, `extension.ts`, `index.ts`).
- `src/lexcube-client/` - **separate npm project** with its own `package.json`, `yarn.lock`, and Vite build. Contains the actual 3D rendering client used by both the widget and standalone web. Source lives in `src/lexcube-client/src/client/` (subdirs: `core/`, `rendering/`, `interaction/`, `services/`, `ui/`).
- `lib/`, `dist/`, `lexcube/labextension/`, `lexcube/nbextension/` - built outputs committed to the repo; do not hand-edit unless the task is explicitly about artifacts.

## Common Commands

Install (run after clone):
```bash
yarn install                                # root JS deps
yarn --cwd src/lexcube-client install       # standalone client deps
python -m venv .venv && source .venv/bin/activate
pip install -e ".[test,examples]"           # triggers Hatch hook -> runs yarn build:prod
```

Build:
```bash
yarn build         # client -> tsc lib -> nbextension webpack -> labextension dev build
yarn build:prod    # same chain, production labextension
yarn watch         # tsc -w + webpack -w + jupyter labextension watch
```

Lint:
```bash
yarn lint:check    # eslint, no fixes
yarn lint          # eslint with --fix
```

Tests (currently unmaintained per SETUP.md - do not assume green on untouched branches):
```bash
yarn test                                       # all Jest tests
yarn test -- src/__tests__/index.spec.ts        # single TS test file
pytest                                          # all Python tests (also runs notebook validation in examples/ via --nbval)
pytest lexcube/tests/test_example.py::test_name -v
```

Standalone web mode (two terminals from project root):
```bash
# Terminal 1 - backend on :5000, reads ./config.json from CWD
source .venv/bin/activate
pip install -r lexcube/lexcube_server/requirements-core.txt
pip install -r lexcube/lexcube_server/requirements-standalone.txt
python lexcube/lexcube_server/src/lexcube_standalone.py

# Terminal 2 - Vite dev server on :8080
yarn --cwd src/lexcube-client dev
```

Version bumps (`tbump.toml` patches `pyproject.toml` and `lexcube/_version.py`; verify other files mentioned in AGENTS.md if bumping):
```bash
tbump <new-version>
```

## Architecture Notes

- The TypeScript widget (`src/widget.ts`) imports the rendering client from `src/lexcube-client/src/client/client.ts` via `CubeClientContext`. The same client code drives both the Jupyter widget and the standalone web app.
- The widget bundle is built by `webpack.config.js` (nbextension) and `webpack.jupyterlab.config.js` (labextension shared deps). The standalone client uses `src/lexcube-client/vite.config.ts`.
- The Hatch build hook in `pyproject.toml` runs `yarn build:prod` during `pip install`/wheel build - expect JS build side effects when installing the Python package.
- `Cube3DWidget` traits in `lexcube/cube3d.py` are kept in sync (`.tag(sync=True)`) with the TS `widget.ts` model; both sides must change together when adding state.
- Standalone reads `config.json` from CWD (`config.example.json` is the template). Datasets are Zarr stores referenced by URL or path under `datasetBaseDir`. Tile cache config (`tileCacheDir`, memory/local cache, pre-generation) is per-dataset.
- Critical asset aliases in webpack config: `pin.glb`, `geojson-loader.worker.ts`, `zfp_codec.wasm`. Preserve these when touching bundling.

## Test/Build Gotchas

- `pytest.ini` includes `examples/` notebooks via `--nbval --current-env`; running `pytest` will validate notebooks against the current env (slow, env-sensitive).
- Tests are marked deprecated/unmaintained in SETUP.md - failures on untouched branches are expected.
- Built artifacts are checked into git (`lib/`, `dist/`, `lexcube/labextension/`, `lexcube/nbextension/`).

## Conventions

- ESLint + Prettier: single quotes, semicolons (`.eslintrc.js`, `.prettierrc`).
- TypeScript config: `tsconfig.json` for lib build, `tsconfig.eslint.json` for linting, `src/lexcube-client/src/client/tsconfig.json` for the client subproject.
