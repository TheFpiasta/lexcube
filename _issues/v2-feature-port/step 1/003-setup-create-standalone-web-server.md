# 003 - Create Standalone Web Server

**Step**: 1 - Setup
**Type**: Setup / Infrastructure
**Priority**: High
**Branch**: `feature-port-to-v2`
**Effort**: Moderate
**Depends On**: 002 (server files)

## Goal

Create the web server process that bridges the client to V2's TileServer. Without this, the web app cannot run. V2 already has `startup_standalone()`, `handle_tile_request_standalone()`, and `handle_event_request_standalone()` - this wires them to HTTP/WebSocket endpoints.

This is the basic server. Features like caching (issue 006) and cancel (issue 007) will adjust the server later.

## What To Do

Create `lexcube/lexcube_server/src/lexcube_standalone.py`:

- **FastAPI** app with CORS middleware
- **socket.io** AsyncServer wrapped with ASGI
- **REST routes**: `GET /api` (status + API_VERSION 6), `GET /api/datasets` (list), `GET /api/datasets/{id}` (detail)
- **Socket.io events**:
    - `request_tile_data` -> `handle_tile_request_standalone()`
    - `request_tile_data_multiple` -> batch handler (V2's client sends this)
    - `request_event_data` -> `handle_event_request_standalone()`
- **GeoJSON serving**: mount geojson dir at root, auto-download from Natural Earth if missing (with timeout + graceful fallback)
- **Error handling**: try/except on ALL socket.io and REST handlers - one bad request must never crash the server
- **Graceful shutdown**: signal handlers (SIGINT, SIGTERM)
- **uvicorn** runner on port 5000
- API metadata includes V2 fields: `max_lod_2d`, `max_lod_3d`, `enable_3d_tiles`

## Architecture Constraints

- **MUST NOT** add authentication or authorization
- **MUST NOT** add APIs beyond /api, /api/datasets, /api/datasets/:id
- **MUST NOT** silently swallow errors - all exceptions logged
- Caching and cancel hooks will be added by later issues (006, 007)

## Files Changed

- `lexcube/lexcube_server/src/lexcube_standalone.py` (new)

## Acceptance

- `python lexcube/lexcube_server/src/lexcube_standalone.py` starts with valid config
- `curl http://localhost:5000/api` -> `{"status": "ok", "api_version": 6}`
- `curl http://localhost:5000/api/datasets` -> JSON array
- GeoJSON served at root path
- Malformed request -> error logged, server stays up
- SIGINT -> graceful shutdown

## Reference

- Feature branch: `merge-v2:lexcube/lexcube_server/src/lexcube_standalone.py` (primary template)
- V2 standalone handlers: `main:tile_server.py:1849-1920`
- V2 startup: `main:tile_server.py:1697-1724`
- V2 widget metadata format: `main:lexcube_widget.py:60-85`
- V2 client events: `main:networking.ts:279-292`
