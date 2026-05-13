from __future__ import annotations

import enum
import math
import os
import time
import warnings
from datetime import datetime
from typing import Union

import bottleneck
import cv2
import numpy as np
import psutil
import xarray as xr

from .constants import NON_EXTREME_QUANTILE_INDEX


class DataSourceProxy:
    def __init__(self, data_source: Union[xr.DataArray, np.ndarray]) -> None:
        self.data_source = data_source
        self.cache_chunks = type(data_source) == xr.DataArray and data_source.chunks and len(data_source.chunks) > 0
        self.shape = self.data_source.shape
        if self.cache_chunks:
            self.x_chunk_indices = np.append(np.array([0]), np.cumsum(data_source.chunks[2]))
            self.y_chunk_indices = np.append(np.array([0]), np.cumsum(data_source.chunks[1]))
            self.z_chunk_indices = np.append(np.array([0]), np.cumsum(data_source.chunks[0]))
            self.x_chunks = self.data_source.chunks[2]
            self.y_chunks = self.data_source.chunks[1]
            self.z_chunks = self.data_source.chunks[0]
        self.chunk_cache = {}

    def find_affected_chunks(self, x: slice, y: slice, z: slice):
        x_chunk_start = np.searchsorted(self.x_chunk_indices, x.start, side="right") - 1
        x_chunk_end = np.searchsorted(self.x_chunk_indices, x.stop - 1, side="right") - 1
        y_chunk_start = np.searchsorted(self.y_chunk_indices, y.start, side="right") - 1
        y_chunk_end = np.searchsorted(self.y_chunk_indices, y.stop - 1, side="right") - 1
        z_chunk_start = np.searchsorted(self.z_chunk_indices, z.start, side="right") - 1
        z_chunk_end = np.searchsorted(self.z_chunk_indices, z.stop - 1, side="right") - 1
        return [(z, y, x) for z in range(z_chunk_start, z_chunk_end + 1) for y in range(y_chunk_start, y_chunk_end + 1) for x in range(x_chunk_start, x_chunk_end + 1)]

    def get_chunk_slices(self, chunk_ix: int, chunk_iy: int, chunk_iz: int):
        return (slice(self.z_chunk_indices[chunk_iz], self.z_chunk_indices[chunk_iz + 1]),
                slice(self.y_chunk_indices[chunk_iy], self.y_chunk_indices[chunk_iy + 1]),
                slice(self.x_chunk_indices[chunk_ix], self.x_chunk_indices[chunk_ix + 1]))

    def get_chunk_slices_for_request(self, chunk_ix: int, chunk_iy: int, chunk_iz: int, x_request_slice: slice, y_request_slice: slice, z_request_slice: slice):
        chunk_slices = self.get_chunk_slices(chunk_ix, chunk_iy, chunk_iz)
        lower_x = max(x_request_slice.start - chunk_slices[2].start, 0)
        upper_x = min(x_request_slice.stop - chunk_slices[2].start, chunk_slices[2].stop - chunk_slices[2].start)
        lower_y = max(y_request_slice.start - chunk_slices[1].start, 0)
        upper_y = min(y_request_slice.stop - chunk_slices[1].start, chunk_slices[1].stop - chunk_slices[1].start)
        lower_z = max(z_request_slice.start - chunk_slices[0].start, 0)
        upper_z = min(z_request_slice.stop - chunk_slices[0].start, chunk_slices[0].stop - chunk_slices[0].start)
        chunk_copy_source_slices = (slice(lower_z, upper_z), slice(lower_y, upper_y), slice(lower_x, upper_x))

        request_copy_target_slice_lower_x = chunk_slices[2].start - x_request_slice.start + lower_x
        request_copy_target_slice_upper_x = request_copy_target_slice_lower_x + upper_x - lower_x
        request_copy_target_slice_lower_y = chunk_slices[1].start - y_request_slice.start + lower_y
        request_copy_target_slice_upper_y = request_copy_target_slice_lower_y + upper_y - lower_y
        request_copy_target_slice_lower_z = chunk_slices[0].start - z_request_slice.start + lower_z
        request_copy_target_slice_upper_z = request_copy_target_slice_lower_z + upper_z - lower_z
        request_copy_target_slices = (slice(request_copy_target_slice_lower_z, request_copy_target_slice_upper_z), slice(request_copy_target_slice_lower_y, request_copy_target_slice_upper_y), slice(request_copy_target_slice_lower_x, request_copy_target_slice_upper_x))
        return (chunk_copy_source_slices, request_copy_target_slices)

    def get_chunk(self, iz: int, iy: int, ix: int):
        chunk_key = (iz, iy, ix)
        if chunk_key not in self.chunk_cache:
            slices = self.get_chunk_slices(ix, iy, iz)
            self.chunk_cache[chunk_key] = self.data_source[slices].values
        return self.chunk_cache[chunk_key]

    def validate_slice(self, s: Union[slice, int], dimension: int):
        if type(s) == int:
            s = slice(s, s + 1)
        return slice(max(s.start, 0), min(s.stop, self.shape[dimension]))

    def __getitem__(self, arg):
        if not self.cache_chunks or type(arg) != tuple or len(arg) != 3:
            return self.data_source.__getitem__(arg)
        (z_request_slice, y_request_slice, x_request_slice) = [self.validate_slice(s, i) for i, s in enumerate(arg)]
        chunks = self.find_affected_chunks(x_request_slice, y_request_slice, z_request_slice)
        output = np.ndarray((z_request_slice.stop - z_request_slice.start, y_request_slice.stop - y_request_slice.start, x_request_slice.stop - x_request_slice.start), dtype=self.data_source.dtype)
        for (iz, iy, ix) in chunks:
            c = self.get_chunk(iz, iy, ix)
            (chunk_copy_source_slices, request_copy_target_slices) = self.get_chunk_slices_for_request(ix, iy, iz, x_request_slice, y_request_slice, z_request_slice)
            np.copyto(output[request_copy_target_slices], c[chunk_copy_source_slices])
        return np.squeeze(output)

    @property
    def dtype(self):
        return self.data_source.dtype


# from: https://stackoverflow.com/a/2135920
def split_list_into_equal_parts(l: list, parts: int):
    k, m = divmod(len(l), parts)
    return ([l[i * k + min(i, m):(i + 1) * k + min(i + 1, m)]] for i in range(parts))


def log_line(f, s: str = "", stdout_too: bool = True):
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - {s}"
    if stdout_too:
        print(line)
    f.write(f"{line}\n")
    f.flush()


def get_current_memory_usage(s: str = ""):
    used_mb = round(psutil.Process(os.getpid()).memory_info().rss / 1024 ** 2, 2)
    available_mb = round(psutil.virtual_memory().available / 1024 ** 2, 2)
    return f"° Currently used memory: {f'{round(used_mb / 1024, 2)} GB'} - Available: {f'{round(available_mb / 1024, 2)} GB'} {f'[{s}]'}"


class PerformanceTimer:
    def __init__(self) -> None:
        self.time_elapsed_since_last_call = time.perf_counter_ns()

    def reset_time_elapsed_since_last_call(self):
        self.time_elapsed_since_last_call = time.perf_counter()

    def print_time_elapsed_since_last_call(self, s: str = ""):
        print(f"........................ [{s}] Time elapsed since last call: {round(time.perf_counter_ns() - self.time_elapsed_since_last_call, 2)} ns")
        self.time_elapsed_since_last_call = time.perf_counter_ns()


class Dimension(enum.Enum):
    Z = 0
    Y = 1
    X = 2


dimension_mapping = {
    "by_z": Dimension.Z,
    "by_y": Dimension.Y,
    "by_x": Dimension.X
}


def downscale_quantile_indices_signed_max_relative(A: np.ndarray) -> np.ndarray:
    if A.ndim != 3:
        raise ValueError(f"Expected 3D array (Z,Y,X), got shape {A.shape}")
    z, y, x = A.shape
    if (z % 2) or (y % 2) or (x % 2):
        raise ValueError(f"All dimensions must be divisible by 2, got {A.shape}")

    dev = A.astype(np.int16) - int(NON_EXTREME_QUANTILE_INDEX)
    blocked = dev.reshape(z // 2, 2, y // 2, 2, x // 2, 2)
    flat = blocked.reshape(z // 2, y // 2, x // 2, 8)

    # pick signed dev with largest absolute value per block
    idx = np.argmax(np.abs(flat), axis=3)
    picked = np.take_along_axis(flat, idx[..., None], axis=3)[..., 0]

    return (picked + int(NON_EXTREME_QUANTILE_INDEX)).astype(np.uint8)


def downscale(a: np.ndarray, factor=0.5):
    return downscale_fast_2d(a, factor) if len(a.shape) == 2 else downscale_3d_nanmean(a, factor)


def downscale_fast_2d(arr: np.ndarray, factor=0.5):
    return cv2.resize(arr, None, fx=factor, fy=factor, interpolation=cv2.INTER_LINEAR)


# Will ignore NaN values and NOT propagate them per 2x2x2 block
def downscale_3d_nanmean(arr: np.ndarray, factor=0.5):
    from skimage.measure import block_reduce

    if factor <= 0:
        raise ValueError("factor must be a positive value.")
    block_factor = int(1 / factor)

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Mean of empty slice.*",
            category=RuntimeWarning,
        )
        return block_reduce(
            arr,
            block_size=(block_factor, block_factor, block_factor),
            func=np.nanmean
        )


# Applies nanmean with intermediate ceil() call to keep positive values over high LoDs (which would otherwise be rounded down to zero)
def downscale_nan_factor_mask(arr: np.ndarray, factor=0.5):
    from skimage.measure import block_reduce
    if factor <= 0:
        raise ValueError("factor must be a positive value.")
    block_factor = int(1 / factor)

    def nanmean_ceiled(blocked, axis):
        m = np.nanmean(blocked, axis=axis, dtype=np.float64)
        return np.ceil(m).astype(np.uint8)

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Mean of empty slice.*",
            category=RuntimeWarning,
        )
        return block_reduce(
            arr,
            block_size=(block_factor, block_factor, block_factor),
            func=nanmean_ceiled,
        )


def downscale_fast_3d(arr, factor=0.5):  # but this probably propogates NaN values, so it sucks
    if factor != 0.5:
        print("Shrinking 3D array by non-2-divisor is not supported")
        return
    v = np.asarray(arr, dtype=np.float32)
    resized_slices = [cv2.resize(s, None, fx=factor, fy=factor, interpolation=cv2.INTER_LINEAR) for s in v]  # bilinear filtering for each plane
    target = np.zeros(tuple(int(x / 2) for x in v.shape), dtype=v.dtype)
    for i in range(int(v.shape[0] / 2)):
        target[i] = (resized_slices[i * 2] + resized_slices[i * 2 + 1]) / 2  # merge adjacent planes, trilinear filtering
    return target


def interpolate_nans_1d(array):
    not_nan = np.logical_not(np.isnan(array))
    indices = np.arange(len(array))
    return np.interp(indices, indices[not_nan], array[not_nan])


def interpolate_and_smooth_nans_1d_padded(array, kernel_size):
    not_nan = np.logical_not(np.isnan(array))
    if not np.any(not_nan):
        return array
    kernel_radius = int((kernel_size - 1) / 2)
    not_nan_indices = np.where(not_nan)
    first_non_nan_index = not_nan_indices[0][0]
    last_non_nan_index = not_nan_indices[0][-1]
    begin_padding_index = max(first_non_nan_index, kernel_radius)
    end_padding_index = min(last_non_nan_index, len(array) - kernel_radius)
    before = array[end_padding_index:]
    after = array[:begin_padding_index + 1]
    result = np.concatenate((before, array, after))
    result = interpolate_nans_1d(result)
    result = apply_mean_filter(result, kernel_size)
    return result[len(before) + kernel_radius:-len(after) + kernel_radius]


def apply_mean_filter(array, kernel_size):
    return bottleneck.move_mean(array, window=kernel_size, min_count=1)


def interpolate_nans_and_smooth(input_list: list):
    for i, (iy, ix, time_series, sparse_doy_keys) in enumerate(input_list):
        kernel_size = 17  # considers 4.6% of the year
        t = np.full(366, np.nan)
        keys = np.fromiter(sparse_doy_keys, np.uint64) - 1
        t[keys] = time_series
        interpolated = interpolate_and_smooth_nans_1d_padded(t, kernel_size)
        input_list[i] = (iy, ix, interpolated[keys])
    return input_list


def sample_data_array_2d(data, sample_factor):
    s = data[::sample_factor, ::sample_factor]
    return np.stack([s[i] for i in range(len(s))])


def calculate_max_lod(tile_size: int, dims: list[int]):
    if tile_size <= 0 or len(dims) == 0 or min(dims) <= 0 or max(dims) <= 0:
        return 0
    desired_max_lod = math.ceil(-math.log2(tile_size / max(dims)))
    largest_lod_possible_from_dims = math.floor(math.log2(min(dims)))
    largest_lod_possible_from_tile_size = math.floor(math.log2(tile_size))
    return max(0, min(desired_max_lod, largest_lod_possible_from_dims, largest_lod_possible_from_tile_size))
