# Interfaces

Python API (notebook)

- `Cube3DWidget(data_source, cmap=None, vmin=None, vmax=None, isometric_mode=False, use_lexcube_chunk_caching=True, overlaid_geojson="", overlaid_geojson_color="black", widget_size=None, cube_scale=None, camera_angle=None)`
- Properties (traitlets): `cmap`, `vmin`, `vmax`, `xlim`, `ylim`, `zlim`, `xwrap`, `ywrap`, `zwrap`, `widget_size`, `cube_scale`, `camera_angle`, `overlaid_geojson`, `overlaid_geojson_color`.
- Methods: `plot/show`, `show_sliders`, `overlay_geojson`, `savefig`, `save_print_template`, `get_current_cube_selection`.

Widget messaging (JS <-> Python)

- Request: `request_tile_data_multiple` with `request_data` array of tile requests.
- Response: `tile_data` payload with `dataSizes` and binary buffers.
- Metadata: `api_metadata` on the widget model includes `/api`, `/api/datasets`, `/api/datasets/default`.

Standalone tile server config

- `config.json` keys (see `lexcube/lexcube_server/config_example.json`):
  - `datasetBaseDir`, `tileCacheDir`, `preGenerationThreads`
  - `datasets[]`: `id`, `shortName`, `datasetPath`, `preGenerationSparsity`, `onlyParameters`, `ignoredParameters`, `overrideMaxLod`, `calculateYearlyAnomalies`, `useOfflineMetadata`

Client URL flags (standalone)

- Detected in `src/lexcube-client/src/client/client.ts`: `debug`, `expert`, `studio`, `scripted`, `noUi`, `orchestrationMinion`, `orchestrationMaster`, `scriptedMultiView`, `textureFiltering`, `isometric`.

Tile protocol (client/server)

- Request fields: `datasetId`, `parameter`, `indexDimension`, `indexValue`, `lod`, `xys`.
- Response fields: `metadata`, `dataSizes`, raw tile data buffer.
- Tile format is versioned (`TILE_VERSION`) and prefixed with magic bytes (`lexc`).
