# AGENTS Guide

## Repo Shape (read before editing)
- This repo is a hybrid Python + Jupyter widget + TS frontend project; most changes touch both `lexcube/` (Python) and `src/` (widget frontend).
- Main Python widget entrypoint is `lexcube/cube3d.py`; Jupyter extension hooks are in `lexcube/__init__.py`.
- Main TS widget entrypoint is `src/widget.ts`; JupyterLab plugin registration is in `src/plugin.ts`.
- `src/lexcube-client/` is a separate npm project (standalone web client) with its own `package.json` and build/dev flow.
- Standalone backend server entrypoint is `lexcube/lexcube_server/src/lexcube_standalone.py` (FastAPI + socket.io).

## Setup and Install
- Install JS deps in both projects: `npm install` (repo root) and `npm install --prefix src/lexcube-client`.
- Use a local venv for Python work: `python -m venv .venv && source .venv/bin/activate`.
- Install editable package with extras: `pip install -e ".[test,examples]"`.
- The Hatch Jupyter build hook in `pyproject.toml` runs `build:prod` during package builds; expect JS build side effects when installing/building Python package.

## High-Value Commands
- Root build chain: `npm run build` (client -> TS lib -> nbextension -> labextension dev build).
- Production packaging build: `npm run build:prod`.
- Lint check only: `npm run lint:check`.
- Lint with autofix: `npm run lint`.
- TS tests: `npm run test` or single file `npm run test -- src/__tests__/index.spec.ts`.
- Python tests: `pytest` (configured by `pytest.ini` to include notebooks via `--nbval --current-env`; slower and environment-sensitive).

## Test and Build Gotchas
- `pytest.ini` sets `testpaths = lexcube/tests examples`; running `pytest` executes notebook validation in `examples/`.
- Tests are marked as not fully maintained in `SETUP.md`; do not assume a clean pass on untouched branches.
- Built outputs are committed in this repo (`lib/`, `dist/`, `lexcube/labextension/`, `lexcube/nbextension/`); avoid manual edits there unless the task is explicitly about built artifacts.

## Standalone Web Mode
- `lexcube_standalone.py` reads `config.json` from the current working directory (run from repo root unless you intentionally use another config location).
- Standalone backend: `python lexcube/lexcube_server/src/lexcube_standalone.py` (port 5000).
- Standalone frontend dev server: `npm run dev --prefix src/lexcube-client` (Vite port 8080, root `src/lexcube-client/src/client`).
- For standalone backend dependencies, install both `lexcube/lexcube_server/requirements-core.txt` and `lexcube/lexcube_server/requirements-standalone.txt`.

## Conventions That Matter
- ESLint + Prettier enforce single quotes and semicolons (`.eslintrc.js`, `.prettierrc`).
- Webpack config contains critical asset aliases (`pin.glb`, `geojson-loader.worker.ts`, `zfp_codec.wasm`); preserve these when touching bundling.
- Version bumps are wired through `tbump.toml` and update multiple files (`package.json`, `lexcube/_frontend.py`, `pyproject.toml`, `lexcube/_version.py`, `src/lexcube-client/src/client/constants.ts`).
