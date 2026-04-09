# Lexcube Feature Comparison (Jupyter vs Web)

This comparison is based only on features implemented in this repository.

## Shared core (both Jupyter widget and web client)

- 3D cube rendering in the browser (WebGL2).
- Mouse/touch interaction for rotate, pan, zoom.
- X/Y/Z selection sliders and visible range controls.
- Colormap selection and custom colormap data.
- vmin/vmax overrides for color range.
- Cube scaling and isometric rendering mode.
- GeoJSON overlay rendering.
- Camera angle read/set.
- Dimension wrap settings (x/y/z wrap).
- Export: screenshots/downloads from the UI.
- Print template generation/download.
- Animation recording in the UI (GIF/MP4/WEBM output).

## Jupyter-specific features

- Accepts live `numpy.ndarray` or `xarray.DataArray` directly in Python.
- In-kernel data access (no external dataset server required).
- Python API methods:
  - `get_current_cube_selection` (returns indices or data subset).
  - `overlay_geojson` (file/URL/object in Python).
  - `savefig` (export PNG from widget).
  - `save_print_template`.
  - `show_sliders` (ipywidgets slider panel).
- Traitlets for programmatic control:
  - `xlim`, `ylim`, `zlim`.
  - `vmin`, `vmax`, `cmap`.
  - `xwrap`, `ywrap`, `zwrap`.
  - `camera_angle`, `cube_scale`, `isometric_mode`, `widget_size`.
- GeoJSON validation and loading handled in Python.
- Optional Lexcube chunk caching for xarray data (`use_lexcube_chunk_caching`).

## Web-specific features (standalone client + server mode)

- Standalone web app can run without Jupyter when backed by a tile server.
- WebSocket tile streaming via `socket.io`.
- Multi-dataset and multi-parameter support (server API exposes datasets/parameters).
- Server-side dataset config, metadata discovery, and caching.
- Remote dataset support in server: local files, HTTP, S3 (Zarr/NetCDF).
- URL-flag modes in the web client:
  - `?debug`, `?studio`, `?expert`, `?scripted`, `?orchestrationMinion`,
    `?orchestrationMaster`, `?noUi`, `?scriptedMultiView`, `?textureFiltering`, `?isometric`.
- Scripted mode exposes browser automation hooks on `window`.

## Key differences

- Data input:
  - Jupyter: direct Python arrays (NumPy/xarray) in memory.
  - Web: requires a dataset server API for tiles and metadata.
- Automation:
  - Jupyter: Python API + traitlets.
  - Web: URL flags + browser scripting hooks.
- Dataset scope:
  - Jupyter: single "default" dataset from the passed array.
  - Web: multiple datasets/parameters via server config and metadata.

## Feature matrix

| Feature                                                                  | Jupyter | Web |
|--------------------------------------------------------------------------|---------|-----|
| 3D cube rendering (WebGL2)                                               | X       | X   |
| Rotate/pan/zoom interaction                                              | X       | X   |
| X/Y/Z selection sliders                                                  | X       | X   |
| Colormap selection                                                       | X       | X   |
| Custom colormap data                                                     | X       | X   |
| vmin/vmax overrides                                                      | X       | X   |
| Cube scaling                                                             | X       | X   |
| Isometric mode                                                           | X       | X   |
| GeoJSON overlay rendering                                                | X       | X   |
| Camera angle read/set                                                    | X       | X   |
| Dimension wrapping (x/y/z)                                               | X       | X   |
| Screenshot export (UI download)                                          | X       | X   |
| Print template download                                                  | X       | X   |
| Animation recording (GIF/MP4/WEBM)                                       | X       | X   |
| Accepts in-memory NumPy/xarray inputs                                    | X       |     |
| In-kernel data access (no external server)                               | X       |     |
| Python API: `get_current_cube_selection`                                 | X       |     |
| Python API: `overlay_geojson`                                            | X       |     |
| Python API: `savefig`                                                    | X       |     |
| Python API: `save_print_template`                                        | X       |     |
| Python API: `show_sliders`                                               | X       |     |
| Traitlets control (`xlim/ylim/zlim`)                                     | X       |     |
| Traitlets control (`vmin/vmax/cmap`)                                     | X       |     |
| Traitlets control (`xwrap/ywrap/zwrap`)                                  | X       |     |
| Traitlets control (`camera_angle/cube_scale/isometric_mode/widget_size`) | X       |     |
| GeoJSON validation/load in Python                                        | X       |     |
| Optional Lexcube chunk caching (xarray)                                  | X       |     |
| Standalone client (no Jupyter)                                           |         | X   |
| WebSocket tile streaming (`socket.io`)                                   |         | X   |
| Multi-dataset and multi-parameter support                                |         | X   |
| Server-side dataset config + metadata discovery                          |         | X   |
| Remote dataset support (HTTP/S3 Zarr/NetCDF)                             |         | X   |
| URL flag modes (debug/studio/expert/scripted/etc.)                       |         | X   |
| Browser automation hooks in scripted mode                                |         | X   |
