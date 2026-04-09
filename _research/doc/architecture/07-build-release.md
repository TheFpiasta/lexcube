# Build and Release

Build surfaces

- Root `package.json`: builds the Jupyter widget (nbextension + labextension) and TS library output.
- `src/lexcube-client/package.json`: builds the standalone client bundle.
- `pyproject.toml`: Python packaging with Hatch + jupyter-builder hook.

Root JS build (widget extension)

- `npm run build` (dev labextension) or `npm run build:prod` (production labextension).
- Outputs:
  - `lexcube/nbextension/index.js` (notebook bundle).
  - `lexcube/labextension/` (JupyterLab extension).
- Labextension packaging configured in `package.json` under `jupyterlab`.

Standalone client build

- `npm run build` in `src/lexcube-client/`.
- Uses webpack configs in `src/lexcube-client/src/client/`.

Python build (Hatch)

- `pyproject.toml` defines `hatch-jupyter-builder` hook.
- `build_cmd = "build:prod"` runs the JS build during wheel/sdist creation.
- Wheel includes nbextension + labextension artifacts via `shared-data` mapping.

Versioning

- Python: `lexcube/_version.py` and `pyproject.toml`.
- JS: `package.json` and `src/version.ts` (reads from package.json).
- `tbump.toml` coordinates version bumps.

Notes

- The repo expects a clean working tree for packaging to avoid untracked files in wheels.
