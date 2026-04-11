# Development Setup (Linux, Windows)

**Preconditions:** Linux, Python 3.9+ with pip, Node.js with npm. On Windows, Git Bash or a similar terminal is recommended.

> **Windows note:** 
> JupyterLab's development mode uses symlinks. 
> On Windows, symlink creation requires either **Developer Mode** (Settings → System → For developers → Developer Mode) or running the terminal as Administrator. Enable Developer Mode before running `jupyter labextension develop`.
> In newer Windows 11 versions u can activate "sudo" in the Settings, to running admin commands from a none admin terminal.

---

## Initial Project Setup (run once after cloning)

```bash
# Install root Jupyter extension dependencies
npm install

# Install standalone web client dependencies (separate npm project)
cd src/lexcube-client && npm install && cd ../..

# Create and activate Python virtual environment
# sudo apt install python-is-python3  # if u dont want to allways type in python3
python -m venv .venv
source .venv/bin/activate
# source .venv/Scripts/activate  # Windows

# Install JupyterLab
pip install jupyterlab

# Install the project (also runs the first TypeScript build via the Hatch hook)
pip install -e ".[test, examples]"
```

---

## JupyterLab Development

**One-time setup** (after initial project setup above):

```bash
# Windows users may need to run the following command with sudo, in an Administrator terminal or with Developer Mode enabled to allow symlink creation.
jupyter labextension develop --overwrite .
# verify the extension (recommended when using windows sudo)
jupyter labextension list # should show lexcube extension enabled

# build the project
npm run build
```

**Development workflow** (two terminals, both with venv active):

```bash
# Terminal 1: activate venv, then watch TypeScript/webpack
source .venv/bin/activate
# source .venv/Scripts/activate  # Windows
npm run watch

# Terminal 2: activate venv, then run JupyterLab
source .venv/bin/activate
# source .venv/Scripts/activate  # Windows
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
# source .venv/Scripts/activate  # Windows

pip install "notebook<7"  # notebook v7 dropped the nbextension system; v6 is required for classic notebook extensions

# Windows users may need to run the following command with sudo, in an Administrator terminal or with Developer Mode enabled to allow symlink creation.
jupyter nbextension install --sys-prefix --symlink --overwrite --py lexcube
# verify the extension (recommended when using windows sudo)
jupyter nbextension list # should show lexcube extension enabled

jupyter nbextension enable --sys-prefix --py lexcube
```

**Development workflow** (two terminals, both with venv active):

```bash
# Terminal 1: activate venv, then watch TypeScript/webpack
source .venv/bin/activate
# source .venv/Scripts/activate  # Windows
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
# source .venv/Scripts/activate  # Windows

# Install standalone-only Python dependencies
pip install -r lexcube/lexcube_server/requirements-standalone.txt

# with zaar 2.x we will ran into a ``cbuffer_sizes`` import error, try to downgrade numcodecs to a version <0.13, to version conflict between zarr 2.x and newer numcodecs.
# Windows notes:
#   numcodecs has to be compiled from source by pip. This required Microsoft C++ Build Tools installed.
#   If u run in errors, check if u have installed it or install it from `https://visualstudio.microsoft.com/de/visual-cpp-build-tools/`
#   In the Installer, select "Desktop development with C++"
#   After installation, please reload / re-open the terminal. 
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
source .venv/bin/activate
# source .venv/Scripts/activate  # Windows

mkdir -p _data

pip install aiohttp # if not already installed on ure system
python -c "import xarray as xr; ds = xr.open_zarr('https://data.rsc4earth.de/download/EarthSystemDataCube/v3.0.2/esdc-16d-2.5deg-46x72x144-3.0.2.zarr/'); ds.to_zarr('_data/esdc-16d-2.5deg-46x72x144-3.0.2.zarr'); print('Done')"
# when running into ssl cert errors, you can try to add the `ssl=False` argument to `xr.open_zarr()` in the above command. This will disable SSL verification and may allow the download to proceed.

# Windows: fixes SSL certificate verification errors permanently
pip install pip-system-certs truststore

# export SSL_CERT_FILE=$&#40;python -m certifi&#41; && python -c "import xarray as xr; ds = xr.open_zarr&#40;'https://data.rsc4earth.de/download/EarthSystemDataCube/v3.0.2/esdc-16d-2.5deg-46x72x144-3.0.2.zarr/', storage_options={'ssl': False}&#41;; ds.to_zarr&#40;'_data/esdc-16d-2.5deg-46x72x144-3.0.2.zarr'&#41;; print&#40;'Done'&#41;"
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
# source .venv/Scripts/activate  # Windows
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
