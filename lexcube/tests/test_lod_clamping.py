#!/usr/bin/env python
# coding: utf-8

import numpy as np
import pytest
import xarray as xr

from lexcube.cube3d import Cube3DWidget
from lexcube.lexcube_server.src.tile_server import calculate_max_lod


def test_calculate_max_lod_never_negative_for_small_shapes():
    assert calculate_max_lod(256, [10, 20, 30]) == 0
    assert calculate_max_lod(256, [1, 1, 1]) == 0


def test_calculate_max_lod_handles_invalid_dimensions_gracefully():
    assert calculate_max_lod(256, [0, 20, 30]) == 0
    assert calculate_max_lod(0, [10, 20, 30]) == 0


@pytest.mark.parametrize(
    "shape",
    [
        (10, 20, 30),
        (1, 1, 1),
        (4, 8, 16),
    ],
)
def test_widget_metadata_lods_for_small_numpy_cubes(shape):
    widget = Cube3DWidget(np.random.rand(*shape).astype("float32"))
    metadata = widget.api_metadata["/api/datasets/default"]

    assert metadata["max_lod_2d"] == 0
    assert metadata["max_lod_3d"] == 0


def test_widget_metadata_lods_are_non_negative_for_small_numpy_data():
    widget = Cube3DWidget(np.random.rand(10, 20, 30).astype("float32"))
    metadata = widget.api_metadata["/api/datasets/default"]

    assert metadata["max_lod_2d"] >= 0
    assert metadata["max_lod_3d"] >= 0


def test_widget_metadata_lods_for_small_xarray_cube():
    time = np.array("2000-01-01", dtype="datetime64[D]") + np.arange(10)
    lat = np.linspace(-90.0, 90.0, 20)
    lon = np.linspace(-180.0, 180.0, 30)
    data = xr.DataArray(
        np.random.rand(10, 20, 30).astype("float32"),
        dims=("time", "lat", "lon"),
        coords={"time": time, "lat": lat, "lon": lon},
        name="var",
    )
    widget = Cube3DWidget(data)
    metadata = widget.api_metadata["/api/datasets/default"]

    assert metadata["max_lod_2d"] == 0
    assert metadata["max_lod_3d"] == 0
