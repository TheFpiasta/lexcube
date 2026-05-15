from __future__ import annotations

import os
import re
from datetime import datetime
from typing import TYPE_CHECKING, Union

import cftime
import fsspec
import numpy as np
import xarray as xr

from .constants import (
    BAND_DIMENSION_NAMES,
    GEOSPATIAL_X_DIMENSION_NAMES,
    GEOSPATIAL_Y_DIMENSION_NAMES,
    LATITUDE_DIMENSION_NAMES,
    LONGITUDE_DIMENSION_NAMES,
    TIME_DIMENSION_NAMES,
)

if TYPE_CHECKING:
    from .server import DatasetConfig, ServerConfig


def patch_data(data: np.ndarray, dataset_id: str, parameter: str, dataset_config: "DatasetConfig" = None) -> np.ndarray:
    if len(data.shape) == 4:  # RGB data does not need patching
        return data
    if dataset_id == "esdc-2.1.1-high-res" and parameter in ["sensible_heat", "terrestrial_ecosystem_respiration", "net_radiation", "net_ecosystem_exchange", "latent_energy", "gross_primary_productivity"]:
        data = np.where(data == -9999, np.nan, data)  # Replace netcdf -9999(=NaN) values
    if parameter == "snow_water_equivalent":
        data = np.where(data == -1, np.nan, data)  # -1 = Oceans = NaN
        data = np.where(data == -2, 0, data)  # -2 = mountains or something...
    return data


def parse_parameter_dimensions_from_dataset(ds: Union[xr.DataArray, xr.Dataset, np.ndarray]):
    from .constants import DEFAULT_DIMENSIONS
    if type(ds) == np.ndarray:
        dims_3d = DEFAULT_DIMENSIONS if len(ds.shape) == 3 else None
        dims_4d = DEFAULT_DIMENSIONS if len(ds.shape) == 4 else None
    elif type(ds) == xr.DataArray:
        dims_3d = ds.dims if len(ds.dims) == 3 else None
        dims_4d = ds.dims if len(ds.dims) == 4 else None
    else:
        parameters_3d = [(p, ds[p].dims, ds[p].shape) for p in ds.data_vars if len(ds[p].dims) == 3]
        parameters_4d = [(p, ds[p].dims, ds[p].shape) for p in ds.data_vars if len(ds[p].dims) == 4]
        if len(parameters_3d) > 0:
            if not all(p[1] == parameters_3d[0][1] for p in parameters_3d):
                raise ValueError(f"Mixed dimension orders for 3d parameters in dataset: {', '.join(p[0] for p in parameters_3d)} ({', '.join(p[1] for p in parameters_3d)})")
        if len(parameters_4d) > 0:
            if not all(p[1] == parameters_4d[0][1] for p in parameters_4d):
                raise ValueError(f"Mixed dimension orders for 4d parameters in dataset: {', '.join(p[0] for p in parameters_4d)} ({', '.join(p[1] for p in parameters_4d)})")
        dims_3d, dims_4d = parameters_3d[0][1] if len(parameters_3d) > 0 else None, parameters_4d[0][1] if len(parameters_4d) > 0 else None
    return (dims_4d or dims_3d), dims_3d, dims_4d


def patch_dataset(ds: Union[xr.DataArray, xr.Dataset, np.ndarray], skip_print: bool = False):
    if type(ds) == np.ndarray:
        return ds

    print_if_needed = print if not skip_print else lambda *args, **kwargs: None

    dims_any, _, dims_4d = parse_parameter_dimensions_from_dataset(ds)

    if dims_4d:
        target_dimension_order = [TIME_DIMENSION_NAMES, GEOSPATIAL_Y_DIMENSION_NAMES, GEOSPATIAL_X_DIMENSION_NAMES, BAND_DIMENSION_NAMES]
        dimension_indices = [next((i for i, d in enumerate(dims_4d) if d in names), -1) for names in target_dimension_order]

        if any(i == -1 for i in dimension_indices):
            raise ValueError(f"Dataset has 4 dimensions {dims_4d}, but does not match required dimensions  ({target_dimension_order})")

        if not dimension_indices == list(range(4)):
            ds = ds.transpose(*[dims_4d[i] for i in dimension_indices])
            _, _, new_dims_4d = parse_parameter_dimensions_from_dataset(ds)
            print_if_needed(f"            * Transposed 4-dimension dataset from {dims_4d} to {new_dims_4d}")
        print_if_needed(f"        > Correctly parsed 4-dimension parameters with dims {dims_4d}")

        dims_any, _, dims_4d = parse_parameter_dimensions_from_dataset(ds)

    # time-DOY data set detection
    if "time" in ds.dims and np.issubdtype(ds["time"].dtype, np.integer) and ds["time"].min() >= 0 and ds["time"].max() <= 365:
        possible_years = re.findall(r'(\d{4})', ds.encoding["source"])
        guessed_year = 1900
        if len(possible_years) > 0:
            guessed_year = possible_years[-1]
            print_if_needed(f"        > Detected time-DOY dataset with year {guessed_year} (from file name)")
        else:
            print_if_needed(f"        > Detected time-DOY dataset, but could not find year in source file name, assigning {guessed_year} as default")
        ds = ds.assign_coords(time=[datetime.strptime(f"{guessed_year}-{doy + 1:03}", "%Y-%j") for doy in ds["time"]])
        print_if_needed(f"            * New first time value: {ds['time'].values[0]} - last: {ds['time'].values[-1]}")

    if dims_any[1] in LONGITUDE_DIMENSION_NAMES and dims_any[2] in LATITUDE_DIMENSION_NAMES:
        dims_any[1], dims_any[2] = dims_any[2], dims_any[1]
        ds = ds.transpose(*dims_any)
        print_if_needed(f"        > Transposed dataset from (..., lon, LAT) to (..., LAT, lon)")
        dims_any, _, dims_4d = parse_parameter_dimensions_from_dataset(ds)

    expected_dimension_increasing = [True, False, True]  # lat is expected decreasing
    expected_names = [TIME_DIMENSION_NAMES, LATITUDE_DIMENSION_NAMES, LONGITUDE_DIMENSION_NAMES]
    for d in range(3):
        if dims_any[d] in expected_names[d]:
            values = ds[dims_any[d]].values
            if len(values) > 1 and (values[0] < values[1]) != expected_dimension_increasing[d]:
                ds = ds.isel({dims_any[d]: slice(None, None, -1)})
                print_if_needed(f"        > Dataset has {dims_any[d]} dimension in {'ascending' if expected_dimension_increasing[d] else 'descending'} order, flipping it to {'ascending' if expected_dimension_increasing[d] else 'descending'} order")

    return ds


def open_dataset(config: "ServerConfig", path: str, skip_print: bool = False) -> xr.Dataset:
    aws_s3_hosted = path.startswith("s3://")
    http_hosted = path.startswith("http://")
    remote_hosted = aws_s3_hosted or http_hosted
    file_extension = path.rstrip("/").split(".")[-1]
    protocol = path.split("://")[0]
    if not skip_print:
        print(f"        > Opening {f'{protocol}-hosted' if remote_hosted else 'locally saved'} dataset ({path})")
    protocol_map = {
        "s3": fsspec.get_mapper(path, anon=True)
    }
    if path.count("*") > 0 and path.endswith(".nc"):
        print("        > Opening globbed multiple NC files [EXPERIMENTAL]")
        print("              Will merge first variable of every file into single variable")
        print("              Assuming 1 time step per file")

        def preprocess(ds):
            current_var_name = list(ds.data_vars)[0]
            target_var_name = "merged_nc_variable"
            ds = ds.rename_vars({current_var_name: target_var_name})
            return ds

        ds = xr.open_mfdataset(os.path.join(config.base_dir, path), engine="netcdf4", combine="nested", concat_dim="time", preprocess=preprocess, parallel=True, chunks={"time": 1})
        ds = patch_dataset(ds, skip_print)
        return ds
    store = (protocol_map.get(protocol) or fsspec.get_mapper(path)) if remote_hosted else os.path.join(config.base_dir, path)
    engines = {
        "zarr": "zarr",
        "nc": "netcdf4"
    }
    ds = xr.open_dataset(store, engine=engines[file_extension], chunks={})
    ds = patch_dataset(ds, skip_print)
    return ds


def get_dimension_type(dimension_name: str):
    if dimension_name in LONGITUDE_DIMENSION_NAMES:
        return "longitude"
    if dimension_name in LATITUDE_DIMENSION_NAMES:
        return "latitude"
    if dimension_name in TIME_DIMENSION_NAMES:
        return "time"
    return "generic"


def get_dimension_labels(data_array: xr.DataArray, dimension_name: str, dimension_type: str = ""):
    dtype = get_dimension_type(dimension_name) if dimension_type == "" else dimension_type

    if dtype == "time":
        if data_array[dimension_name].dtype == cftime.datetime:
            return np.datetime_as_string([np.datetime64(str(d)) for d in data_array[dimension_name].values], timezone="UTC").tolist()
        elif np.issubdtype(data_array[dimension_name].dtype, str):
            return data_array[dimension_name].values.tolist()
        elif np.issubdtype(data_array[dimension_name].dtype, np.datetime64):
            return np.datetime_as_string(data_array[dimension_name].values, timezone="UTC").tolist()
        else:
            raise ValueError(f"Unsupported time dimension dtype: {data_array[dimension_name].dtype}")
    return data_array[dimension_name].values.tolist()
