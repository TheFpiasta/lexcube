# Containers

This section describes the main runtime containers and their responsibilities.

Containers (C4 L2)

```mermaid
flowchart TB
  subgraph NotebookRuntime[Jupyter Notebook/Lab]
    pyPkg["Python Package<br/>lexcube/"]
    jsWidget["Widget Frontend<br/>src/ + lexcube/nbextension + lexcube/labextension"]
  end

  subgraph BrowserRuntime[Web Browser]
    standaloneClient["Standalone Client<br/>src/lexcube-client/"]
  end

  subgraph ServerRuntime[Tile Server]
    tileServer["Tile Server Core<br/>lexcube/lexcube_server/src"]
  end

  dataSources["Data Sources<br/>Zarr/NetCDF, local/remote"]
  tileCache["Tile Cache<br/>on disk"]

  pyPkg <--> jsWidget
  jsWidget --> dataSources
  standaloneClient <--> tileServer
  tileServer --> dataSources
  tileServer --> tileCache
```

Container responsibilities

- Python package (`lexcube/`): public API for notebooks, widget model, traitlets sync, and widget-mode tile server startup.
- Widget frontend (`src/`): Jupyter widget view/model, links UI to the client rendering/interaction engine.
- Standalone client (`src/lexcube-client/`): browser UI and rendering stack, connects to tile server via WebSocket.
- Tile server core (`lexcube/lexcube_server/src/`): dataset loading, tiling, compression, caching, metadata discovery.

Entry points

- Python API: `lexcube/cube3d.py` (`Cube3DWidget`, `Sliders`).
- Widget frontend: `src/widget.ts` (model/view), `src/extension.ts` (nbextension entry).
- JupyterLab plugin: `src/plugin.ts` (registry integration).
- Client app: `src/lexcube-client/src/client/client.ts`.
- Tile server core: `lexcube/lexcube_server/src/tile_server.py` and `lexcube/lexcube_server/src/lexcube_widget.py`.
