# Lexcube - Interactive 3D Data Cube Visualization
# Copyright (C) 2022 Maximilian Söchting <maximilian.soechting@uni-leipzig.de>
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

from __future__ import annotations
from .tile_server import DEFAULT_CACHE_LOCAL_MAX_GB, DEFAULT_DIMENSIONS, DEFAULT_VARIABLE_NAME, TileServer, calculate_max_lod, API_VERSION, get_dimension_labels
from typing import Union
import ipywidgets as widgets
import numpy as np
import xarray as xr


def start_tile_server_in_widget_mode(widget: widgets.DOMWidget, data_source: Union[xr.DataArray, xr.Dataset, np.ndarray], use_lexcube_chunk_caching: bool,
                                     cache_memory_enabled: bool = True,
                                     cache_local_enabled: bool = True,
                                     cache_local_dir: str = "",
                                     cache_local_max_cache_gb: float = DEFAULT_CACHE_LOCAL_MAX_GB,
                                     cache_local_pre_generation_offset_2d: int = 0,
                                     cache_local_pre_generation_offset_3d: int = 0,
                                     cache_local_pre_generation_all_lods_2d: bool = True,
                                     cache_local_pre_generation_all_lods_3d: bool = False):
    if type(data_source) not in [xr.DataArray, xr.Dataset, np.ndarray]:
        print("Error: Input data is not xarray.DataArray or xr.Dataset or numpy.ndarray")
        raise Exception("Error: Input data is not xarray.DataArray or xr.Dataset or numpy.ndarray")
    if not (len(data_source.shape) == 3 or len(data_source.shape) == 4):
        print("Error: Data source is not 3- or 4-dimensional")
        raise Exception("Error: Data source is not 3- or 4-dimensional")

    tile_server = TileServer(widget_mode = True)
    tile_server.startup_widget(
        data_source, use_lexcube_chunk_caching,
        cache_memory_enabled=cache_memory_enabled,
        cache_local_enabled=cache_local_enabled,
        cache_local_dir=cache_local_dir,
        cache_local_max_cache_gb=cache_local_max_cache_gb,
        cache_local_pre_generation_offset_2d=cache_local_pre_generation_offset_2d,
        cache_local_pre_generation_offset_3d=cache_local_pre_generation_offset_3d,
        cache_local_pre_generation_all_lods_2d=cache_local_pre_generation_all_lods_2d,
        cache_local_pre_generation_all_lods_3d=cache_local_pre_generation_all_lods_3d,
    )
    
    data_source = tile_server.data_source # tile server may have patched/modified data set

    def reply(content, buffers = None):
        widget.send(content, buffers)
    
    def receive_message(widget, content, buffers):
        requests = content["request_data"]
        tile_server.pre_register_requests(requests)
        tile_server._pregen_store.clear()
        for request in requests:
            tile_server._cancel_dispatcher()
            tile_server.background_gen_manager.cancel()
            response = tile_server.handle_tile_request_widget(request)
            reply(response[0], response[1])
            tile_server._start_dispatcher()

    if type(data_source) == xr.DataArray:
        dims = data_source.dims
        if len(dims) != 3:
            raise Exception(f"Expected 3 dimensions, got {len(dims)} dimensions in DataArray: {dims}")
        variable_name = data_source.name
        indices = { "z": get_dimension_labels(data_source, dims[0]), "y": get_dimension_labels(data_source, dims[1]), "x": get_dimension_labels(data_source, dims[2]) }
    elif type(data_source) == xr.Dataset:
        pass
    else:
        dims = DEFAULT_DIMENSIONS
        variable_name = DEFAULT_VARIABLE_NAME
        indices = { "z": list(range(data_source.shape[0])), "y": list(range(data_source.shape[1])), "x": list(range(data_source.shape[2])) }

    data_source_name = f"{type(data_source)}"

    data_attributes = {}
    if type(data_source) == xr.DataArray:
        data_attributes = data_source.attrs

    widget.api_metadata = {
        "/api": {"status":"ok", "api_version": API_VERSION},
        "/api/datasets": [{ "id": "default", "shortName": data_source_name }],
        "/api/datasets/default": { 
            "dims": { f"{dims[0]}": data_source.shape[0], f"{dims[1]}": data_source.shape[1], f"{dims[2]}": data_source.shape[2] },
            "dims_ordered": dims,
            "attrs": { },
            "data_vars": { variable_name: { "attrs": data_attributes }}, 
            "indices": indices, 
            "max_lod_2d": calculate_max_lod(tile_server.TILE_SIZE_2D, data_source.shape),
            "max_lod_3d": calculate_max_lod(tile_server.TILE_SIZE_3D, data_source.shape),
            "enable_2d_tiles": True,
            "enable_3d_tiles": True,
            "sparsity": 1,
            "cache_memory_enabled": tile_server.widget_cache_config.memory_enabled
        }
    }

    widget.on_msg(receive_message)

    return (tile_server, dims, indices)
