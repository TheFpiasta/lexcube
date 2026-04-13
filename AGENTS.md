# AGENTS.md

High-signal repo notes for OpenCode sessions.

## Build and dev

- Root build chain: `npm run build` (dev) or `npm run build:prod` (prod). It runs `build:client` -> `build:lib` -> `build:nbextension` -> `build:labextension*`.
- 3D client is its own build surface: `cd src/lexcube-client` then `npm run build` / `npm run dev`.
- Active dev: run `npm run watch` in one terminal and `jupyter lab` in another; refresh browser after rebuilds. Python changes need kernel restart.

## Python packaging + Jupyter hooks

- `pip install -e ".[test, examples]"` triggers the Hatch jupyter-builder hook which runs `npm run build:prod`.
- Stale-build gotcha: Hatch skips rebuild if `lexcube/nbextension/index.js` and `lexcube/labextension/package.json` already exist. Delete them or run `npm run build:prod` if TS changes do not show up after install.
- For JupyterLab dev wiring: `jupyter labextension develop --overwrite .` then `npm run build`.
- For classic notebook: `jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube` then `jupyter nbextension enable --sys-prefix --py lexcube`. On Windows, `--symlink` may not work; re-run install after rebuilds or enable dev symlinks.

## Tests and lint

Note: currently all tests are deprecated/outdated.

- Jest: `npm run test` or single file `npm run test -- src/__tests__/index.spec.ts`.
- Pytest uses nbval by default (`pytest.ini` adds `--nbval --current-env`). Single test example: `pytest lexcube/tests/test_example.py::test_example_creation_blank -v`.
- Lint: `npm run lint` (auto-fix) or `npm run lint:check`.

## Key architecture entrypoints

- Python widget API: `lexcube/cube3d.py`.
- Tile server + widget bridge: `lexcube/lexcube_server/src/tile_server.py`, `lexcube/lexcube_server/src/lexcube_widget.py`.
- Frontend bridge: `src/widget.ts` -> 3D client entry `src/lexcube-client/src/client/client.ts`.

## Repo-specific quirks

- `numcodecs` is not from npm registry; it is a local tarball `src/lexcube-client/deps/numcodecs-0.2.5.tgz` referenced in `src/lexcube-client/package.json`.
- Release bump uses `tbump` (updates `pyproject.toml`, `lexcube/_version.py`, `package.json` and tags).
