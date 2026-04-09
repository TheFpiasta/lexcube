# Deployment

Widget mode deployment

- Installed via `pip install lexcube` (or editable install for dev).
- JupyterLab and Notebook extensions are bundled with the Python package.
- Jupyter discovers widget assets via `_jupyter_labextension_paths` and `_jupyter_nbextension_paths` in `lexcube/__init__.py`.

Standalone mode deployment (server + client)

- Tile server reads datasets from `config.json` (see `lexcube/lexcube_server/config_example.json`).
- Dockerfile exists for a FastAPI/uvicorn base image: `lexcube/lexcube_server/Dockerfile`.
- The Dockerfile expects a `src/lexcube_standalone.py` entrypoint, which is not in this repo snapshot.

Runtime requirements

- Browser: WebGL2, WebSocket, WebAssembly.
- Python: xarray, dask, zarr/netCDF dependencies (see `pyproject.toml`).
- Optional: large local disk for tile cache in standalone mode.

Dev workflows (from AGENTS.md)

- `pip install -e ".[test, examples]"` for dev install (also builds TS).
- JupyterLab dev linkage: `jupyter labextension develop --overwrite .` then `npm run build`.
- Classic notebook: `jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube` then `jupyter nbextension enable --sys-prefix --py lexcube`.
