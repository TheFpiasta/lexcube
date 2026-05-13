from __future__ import annotations

import os
from itertools import groupby
from operator import itemgetter
from typing import TYPE_CHECKING, Callable, List

from .utils import Dimension

if TYPE_CHECKING:
    from .server import Dataset, Tile2D, Tile3D, TileDiskStorage, TileGenerationCache


class BlockFile2D:
    def __init__(self, tile_disk_storage: "TileDiskStorage", dataset: "Dataset", parameter: str, index_dimension: Dimension, index_value: int) -> None:
        self.path = tile_disk_storage.get_block_file_2d_path(dataset, parameter, index_dimension, index_value)
        self.block_contents = dataset.block_2d_contents_by_dim_and_lod[index_dimension.value]
        self.data = None
        self.block_sizes = []
        self.total_tiles = sum([s[0] * s[1] for s in self.block_contents])

    def exists(self):
        return os.path.exists(self.path)

    def load_header(self):
        self.file = open(self.path, "rb")
        header_data = self.file.read(4 * self.total_tiles)
        for i in range(self.total_tiles):
            self.block_sizes.append(int.from_bytes(header_data[i * 4:(i + 1) * 4], byteorder="little"))

    def get_tile_data(self, tiles: List["Tile2D"]):
        total = bytearray()
        sizes = []
        header_offset = self.total_tiles * 4
        block_index_offset = sum([s[0] * s[1] for s in self.block_contents[:tiles[0].lod]])  # offset from previous LoDs, assumed LoD is the same throughout all tiles
        block_indices = []
        for tile in tiles:
            block_indices.append(block_index_offset + tile.ty * self.block_contents[tile.lod][0] + tile.tx)  # collect indices of all requested tiles
        group_function: Callable[[List[int]], int] = lambda indices: indices[0] - indices[1]
        for _, g in groupby(enumerate(block_indices), group_function):  # group adjacent requested tiles to read them together
            group = list(map(itemgetter(1), g))
            my_byte_offset = header_offset + sum([s for s in self.block_sizes[:group[0]]])
            self.file.seek(my_byte_offset)
            for e in group:
                my_byte_size = self.block_sizes[e]
                total += self.file.read(my_byte_size)
                sizes.append(my_byte_size)
        return (sizes, total)

    @staticmethod
    def convert_intermediate_single_tile_files(tile_size: int, tile_disk_storage: "TileDiskStorage", generation_cache: "TileGenerationCache", dataset: "Dataset", parameter: str, index_dimension: Dimension, index_value: int):
        from .server import Tile2D
        # tiles are in correct order already
        tiles: List[Tile2D] = Tile2D.get_tiles_in_range(tile_size, dataset, parameter, index_dimension, [index_value], range(0, dataset.max_lod_2d + 1))

        header_data = bytearray()
        body_data = bytearray()
        for t in tiles:
            tile_data = generation_cache.get_data(t)
            header_data += int.to_bytes(len(tile_data), 4, byteorder="little")
            body_data += tile_data

        with open(tile_disk_storage.get_block_file_2d_path(dataset, parameter, index_dimension, index_value), "wb") as file:
            file.write(header_data)
            file.write(body_data)

        if generation_cache.save_on_disk:
            for t in tiles:
                os.remove(tile_disk_storage.get_tile_2d_path(t, generation_cache.tile_format))

        return len(header_data) + len(body_data)


class BlockFile3D:
    def __init__(self, tile_disk_storage: "TileDiskStorage", dataset: "Dataset", parameter: str, lod: int, z: int, tile_format: str, index_mask_event_type: str = "") -> None:
        self.path = tile_disk_storage.get_block_file_3d_path(dataset, parameter, lod, z, tile_format) if not index_mask_event_type else tile_disk_storage.get_index_mask_block_file_path(dataset, parameter, index_mask_event_type, lod, z)
        self.block_contents = dataset.block_3d_contents_by_lod[lod]
        self.total_tiles = self.block_contents[0] * self.block_contents[1]
        self.block_sizes = []
        self.tile_format = tile_format

    def exists(self):
        return os.path.exists(self.path)

    def load_header(self):
        self.file = open(self.path, "rb")
        header_data = self.file.read(4 * self.total_tiles)
        for i in range(self.total_tiles):
            self.block_sizes.append(int.from_bytes(header_data[i * 4:(i + 1) * 4], byteorder="little"))

    def get_tile_data(self, tiles: List["Tile3D"]):
        total = bytearray()
        sizes = []
        header_offset = self.total_tiles * 4
        block_indices = []
        tiles_per_row = self.block_contents[0]
        for tile in tiles:
            block_indices.append(tile.ty * tiles_per_row + tile.tx)  # collect indices of all requested tiles

        group_function: Callable[[List[int]], int] = lambda indices: indices[0] - indices[1]
        for _, g in groupby(enumerate(block_indices), group_function):  # group adjacent requested tiles to read them together
            group = list(map(itemgetter(1), g))
            my_byte_offset = header_offset + sum([s for s in self.block_sizes[:group[0]]])
            self.file.seek(my_byte_offset)
            for e in group:
                my_byte_size = self.block_sizes[e]
                total += self.file.read(my_byte_size)
                sizes.append(my_byte_size)
        return (sizes, total)

    @staticmethod
    def convert_intermediate_single_tile_files(tile_size: int, tile_disk_storage: "TileDiskStorage", generation_cache: "TileGenerationCache", dataset: "Dataset", parameter: str, lod: int, z: int, tile_format: str):
        from .server import Tile3D
        # tiles are in correct order already
        tiles: List[Tile3D] = Tile3D.get_tiles_in_range(tile_size, dataset, parameter, [z], lod)

        header_data = bytearray()
        body_data = bytearray()
        for t in tiles:
            tile_data = generation_cache.get_data(t)
            header_data += int.to_bytes(len(tile_data), 4, byteorder="little")
            body_data += tile_data

        with open(tile_disk_storage.get_block_file_3d_path(dataset, parameter, lod, z, tile_format), "wb") as file:
            file.write(header_data)
            file.write(body_data)

        if generation_cache.save_on_disk:
            for t in tiles:
                os.remove(tile_disk_storage.get_tile_3d_path(t, tile_format))

        return len(header_data) + len(body_data)
