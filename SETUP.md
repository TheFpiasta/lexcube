# Development Setup

**Preconditions:** Linux, Python 3.9+ with pip, Node.js with npm.

---

## Initial Project Setup (run once after cloning)

```bash
# Install root Jupyter extension dependencies
npm install

# Install standalone web client dependencies (separate npm project)
cd src/lexcube-client && npm install && cd ../..

# Create and activate Python virtual environment
python -m venv .venv
source .venv/bin/activate

# Install JupyterLab
pip install jupyterlab

# Install the project (also runs the first TypeScript build via the Hatch hook)
pip install -e ".[test, examples]"
```

---

## JupyterLab Development

**One-time setup** (after initial project setup above):

```bash
jupyter labextension develop --overwrite .
npm run build
```

**Development workflow** (two terminals, both with venv active):

```bash
# Terminal 1: activate venv, then watch TypeScript/webpack
source .venv/bin/activate
npm run watch

# Terminal 2: activate venv, then run JupyterLab
source .venv/bin/activate
jupyter lab
```

After TypeScript rebuilds, refresh the browser tab. Python changes require a kernel restart.

**Verify** by creating a new notebook (Python 3) and running:

```python
import numpy as np
import lexcube

data = np.random.rand(10, 20, 30).astype("float32")
lexcube.Cube3DWidget(data)
```

A 3D cube that you can rotate and zoom should appear. You may see the following warning - it is harmless and should be address / fixed later:
```
UserWarning: Pandas requires version '1.4.2' or newer of 'bottleneck' (version '1.4.0' currently installed).
```

---

## Classic Notebook Development

**One-time setup** (after initial project setup above):

```bash
source .venv/bin/activate
pip install "notebook<7"  # notebook v7 dropped the nbextension system; v6 is required for classic notebook extensions
jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube
jupyter nbextension enable --sys-prefix --py lexcube
```

**Development workflow** (two terminals, both with venv active):

```bash
# Terminal 1: activate venv, then watch TypeScript/webpack
source .venv/bin/activate
npm run watch

# Terminal 2: activate venv, then run classic notebook
source .venv/bin/activate
jupyter notebook
```

After TypeScript rebuilds, refresh the browser tab. Python changes require a kernel restart.

**Verify** by creating a new notebook (Python 3) and running:

```python
import numpy as np
import lexcube

data = np.random.rand(10, 20, 30).astype("float32")
lexcube.Cube3DWidget(data)
```

A 3D cube that you can rotate and zoom should appear. You may see the following warning - it is harmless and should be address / fixed later:
```
UserWarning: Pandas requires version '1.4.2' or newer of 'bottleneck' (version '1.4.0' currently installed).
```

---

## Web Version (Standalone Server) Development

The standalone web version runs the 3D client (`src/lexcube-client/`) in a browser without Jupyter. The webpack dev server (port 8080) serves the frontend; the Python server (port 5000) serves tile data and metadata via socket.io.

**One-time setup** (after initial project setup above):

```bash
source .venv/bin/activate

# Install standalone-only Python dependencies
pip install -r lexcube/lexcube_server/requirements-standalone.txt

# Fix version conflict between zarr 2.x and newer numcodecs (cbuffer_sizes import error)
pip install "numcodecs<0.13"

# Create your config.json from the provided example
cp lexcube/lexcube_server/config_example.json config.json
```

Edit `config.json` in the project root. Datasets can be loaded from a **remote URL** or a **local path**:

**Remote (URL):** Set `datasetPath` to the full Zarr URL - no download needed. `datasetBaseDir` is ignored.
```json
{
    "id": "my-dataset",
    "shortName": "My Dataset",
    "datasetPath": "https://data.rsc4earth.de/download/EarthSystemDataCube/v3.0.2/esdc-16d-2.5deg-46x72x144-3.0.2.zarr/"
}
```

**Local:** Set `datasetBaseDir` to the directory containing your data files (absolute or relative to project root, e.g. `"_data"`). Set `datasetPath` to the filename relative to `datasetBaseDir`. Download the Zarr store first:
```bash
mkdir -p _data
python -c "import xarray as xr; ds = xr.open_zarr('https://data.rsc4earth.de/download/EarthSystemDataCube/v3.0.2/esdc-16d-2.5deg-46x72x144-3.0.2.zarr/'); ds.to_zarr('_data/esdc-16d-2.5deg-46x72x144-3.0.2.zarr'); print('Done')"
```
Then reference it in `config.json`:
```json
{
    "id": "my-dataset",
    "shortName": "My Dataset",
    "datasetPath": "esdc-16d-2.5deg-46x72x144-3.0.2.zarr"
}
```

Set `tileCacheDir` to a path where generated tiles will be stored (e.g. `.tiles`). See `config_example.json` for all available dataset options.

**Development workflow** (two terminals, run from project root):

```bash
# Terminal 1: activate venv, then start the Python tile server
# Reads config.json from the current directory.
# On first run, metadata discovery may take several minutes per dataset.
source .venv/bin/activate
python lexcube/lexcube_server/src/lexcube_standalone.py

# Terminal 2: webpack dev server with hot reload (no venv needed)
cd src/lexcube-client && npm run dev
```

Open **http://localhost:8080** in a browser.

Frontend changes to `src/lexcube-client/src/client/*.ts` auto-rebuild and hot-reload. Backend changes require restarting the Python server.

---

## Running Tests

```bash
pytest                                                      # all Python tests
pytest lexcube/tests/test_example.py::test_name -v         # single Python test
npm run test                                                # all TypeScript tests (Jest)
npm run test -- src/__tests__/index.spec.ts                 # single TypeScript test file
```
