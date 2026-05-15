from __future__ import annotations

from typing import Union

import numcodecs
import numpy as np

from .constants import (
    TILE_FORMAT_BLOSC_LZ4,
    TILE_FORMAT_ZFP,
    TILE_3D_FORMAT_VLQ,
)


class ZfpCompressor:
    def __init__(self) -> None:
        self.tolerance = -1.0
        self.rate = -1.0
        self.precision = -1.0

    def encode(self, data: np.ndarray):
        import zfpy
        return zfpy.compress_numpy(data, self.tolerance, self.rate, self.precision)

    def decode(self, data: bytes):
        import zfpy
        return zfpy.decompress_numpy(data)


class TileCompressor:
    def __init__(self, current_output_tile_format: str) -> None:
        self.current_output_tile_format = current_output_tile_format  # set for widget mode to lossless, during pregeneration
        self.default_compression_tolerance = -1
        self.anomaly_compression_tolerance = -1
        self.tile_data_compressor_zfp = ZfpCompressor()
        self.tile_data_compressor_blosc_lz4_lossless = numcodecs.blosc.Blosc()
        self.nan_mask_compressor = numcodecs.lz4.LZ4(5)

    def set_tolerance(self, default_compression_tolerance: float, anomaly_compression_tolerance: float):
        self.default_compression_tolerance = default_compression_tolerance
        self.anomaly_compression_tolerance = anomaly_compression_tolerance

    def compress_nan_mask(self, nan_mask: bytes) -> bytes:
        return self.nan_mask_compressor.encode(nan_mask)

    def decompress_nan_mask(self, data: bytes) -> bytes:
        return self.nan_mask_compressor.decode(data)

    def is_currently_encoding_losslessly(self) -> bool:
        return self.current_output_tile_format == TILE_FORMAT_BLOSC_LZ4

    def get_tile_data_compressor(self, use_lossless_override: Union[bool, None] = None):
        if self.current_output_tile_format == TILE_FORMAT_BLOSC_LZ4 or use_lossless_override == True:
            return self.tile_data_compressor_blosc_lz4_lossless
        elif self.current_output_tile_format == TILE_FORMAT_ZFP:
            return self.tile_data_compressor_zfp
        elif self.current_output_tile_format == TILE_3D_FORMAT_VLQ:
            return self.tile_data_compressor_vlq
        else:
            raise ValueError(f"Unsupported tile format: {self.current_output_tile_format}")

    def compress_tile_data(self, tile_coords: tuple, tile_data: np.ndarray, is_anomaly_tile: bool = False) -> bytes:
        compressor = self.get_tile_data_compressor()
        if self.current_output_tile_format == TILE_FORMAT_ZFP:
            self.tile_data_compressor_zfp.tolerance = self.anomaly_compression_tolerance if is_anomaly_tile else self.default_compression_tolerance
        if self.current_output_tile_format == TILE_3D_FORMAT_VLQ:
            self.tile_data_compressor_vlq.rmse_threshold = self.anomaly_compression_tolerance if is_anomaly_tile else self.default_compression_tolerance
            self.tile_data_compressor_vlq.absolute_error_threshold = self.anomaly_compression_tolerance if is_anomaly_tile else self.default_compression_tolerance
        result = compressor.encode(tile_data)
        if self.current_output_tile_format == TILE_3D_FORMAT_VLQ:
            self.tile_data_compressor_vlq.persist_last_payload_stats("-".join(map(str, tile_coords)))
        return result

    def decompress_tile_data(self, tile_data: bytes, use_lossless_override: Union[bool, None] = None) -> np.ndarray:
        return self.get_tile_data_compressor(use_lossless_override).decode(tile_data)
