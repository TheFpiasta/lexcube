# Lexcube Architecture Docs

This folder documents the project architecture top-down with C4-style levels, component breakdowns, data flows, build/release pipeline, and deployment modes.

Architecture at a glance

- Widget mode: Python `Cube3DWidget` embeds the JS client in Jupyter, and an in-process tile server streams tiles via widget messages.
- Standalone mode: Browser client connects to a tile server over WebSocket for dataset discovery and tile streaming.
- Shared client core: rendering, interaction, networking, and tile decoding live in `src/lexcube-client/src/client/` and are used by both modes.

Project layout (focused)

```
.
├─ lexcube/                      # Python package (widget API + server)
│  ├─ cube3d.py                  # Cube3DWidget/Sliders public API
│  ├─ _frontend.py               # JS module name/version for widget
│  ├─ lexcube_server/            # Tile server core
│  │  ├─ config_example.json     # Standalone server config example
│  │  └─ src/
│  │     ├─ tile_server.py       # Dataset loading, tiling, compression, cache
│  │     └─ lexcube_widget.py    # Widget-mode bridge
│  ├─ nbextension/               # Notebook bundle output
│  └─ labextension/              # JupyterLab bundle output
├─ src/                          # Widget frontend + JS entry points
│  ├─ widget.ts                  # Widget view/model, embeds client
│  ├─ plugin.ts                  # JupyterLab plugin registration
│  ├─ extension.ts               # Notebook extension entry
│  └─ lexcube-client/            # Standalone client app
│     └─ src/client/
│        ├─ client.ts            # CubeClientContext
│        ├─ networking.ts        # WebSocket + widget transport
│        ├─ rendering.ts         # Three.js rendering pipeline
│        ├─ interaction.ts       # UI + selection + controls
│        └─ tiledata.ts          # Tile decode + textures + colormap
├─ docs/                         # Sphinx documentation
├─ examples/                     # Example notebooks
├─ css/                          # Widget CSS
└─ _research/                    # Research notes
   └─ doc/architecture/          # This architecture documentation
```

Navigation

- 01-context.md
- 02-containers.md
- 03-components-widget.md
- 04-components-server.md
- 05-components-client.md
- 06-data-flow.md
- 07-build-release.md
- 08-deployment.md
- 09-interfaces.md

Conventions

- Paths are workspace-relative.
- Widget mode = Jupyter ipywidgets integration.
- Standalone mode = browser client + WebSocket tile server.
- Mermaid diagrams are included where they clarify flows or structure.
