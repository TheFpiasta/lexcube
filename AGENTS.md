# AGENTS.md

## Scope + structure

- Python package is built with Hatch; JS/TS assets are built via npm and bundled into `lexcube/nbextension` and `lexcube/labextension` (see `pyproject.toml` jupyter-builder hook).
- There are two JS build surfaces: repo root `package.json` (Jupyter widget build) and `src/lexcube-client/package.json` (client webpack build/dev server).

## Setup

- Use a Python virtualenv at `.venv` for any Python execution in this repo.
- Dev install (also builds TS): `pip install -e ".[test, examples]"`.
- JupyterLab dev linkage: `jupyter labextension develop --overwrite .` then `npm run build`.
- Classic notebook dev linkage: `jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube` then `jupyter nbextension enable --sys-prefix --py lexcube`.

## Common commands

- Root JS build: `npm run build` (dev labextension) or `npm run build:prod` (prod labextension).
- Root JS watch: `npm run watch` (lab/nbextension rebuilds); run `jupyter lab` in another terminal.
- Root JS lint/test: `npm run lint` (auto-fixes) or `npm run lint:check`, `npm run test`.
- Client build/dev (only for `src/lexcube-client`): `npm run build` or `npm run dev` in that directory.

## Release/build quirks

- `npm run build:prod` is the build command used by the Hatch jupyter-builder hook.
- Python package build expects a clean working tree; untracked files get included in the wheel.

## Docs

- Sphinx docs live in `docs/`; use `make -C docs <target>` (e.g., `make -C docs html`).
