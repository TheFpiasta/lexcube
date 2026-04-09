# Data Flow

Two primary flows: widget mode (Jupyter) and standalone mode (browser + server).

Widget mode tile flow

```mermaid
sequenceDiagram
  participant User
  participant WidgetView as JS Widget View
  participant Client as CubeClientContext
  participant PyWidget as Cube3DWidget
  participant TileServer as TileServer (widget mode)

  User->>WidgetView: interact/rotate/zoom/select
  WidgetView->>Client: update selection + request tiles
  Client->>WidgetView: requestTileDataFromWidget(payload)
  WidgetView->>PyWidget: send request payload
  PyWidget->>TileServer: handle_tile_request_widget
  TileServer-->>PyWidget: tile_data + buffers
  PyWidget-->>WidgetView: send tile_data
  WidgetView->>Client: onTileData(buffer)
  Client->>Client: decode + update textures
```

Standalone mode tile flow

```mermaid
sequenceDiagram
  participant User
  participant Client as Standalone Client
  participant Socket as WebSocket
  participant TileServer as TileServer (standalone)
  participant TileCache as Tile Cache
  participant Data as Dataset

  User->>Client: select dataset/parameter
  Client->>Socket: request_tile_data
  Socket->>TileServer: handle_tile_request_standalone
  TileServer->>TileCache: read cached block (if exists)
  alt cache hit
    TileCache-->>TileServer: tile bytes
  else cache miss
    TileServer->>Data: generate tiles
  end
  TileServer-->>Socket: tile_data + sizes
  Socket-->>Client: tile_data + ArrayBuffer
  Client->>Client: decode + update textures
```

Metadata flow (widget mode)

- Python `start_tile_server_in_widget_mode` computes metadata and pushes it to `api_metadata`.
- Widget view fetches metadata via `fetchMetadataFromWidget` to populate cube/parameter lists.

Compression and tile format

- Tiles are compressed with ZFP (lossy) or Blosc/LZ4 (lossless + NaN masks).
- Tiles are versioned and prefixed with magic bytes (`lexc`) to validate payloads.
