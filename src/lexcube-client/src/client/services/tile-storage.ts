/*
    Lexcube - Interactive 3D Data Cube Visualization
    Copyright (C) 2022 Maximilian Söchting <maximilian.soechting@uni-leipzig.de>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Texture, RedFormat, FloatType, LinearFilter, NearestFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, Data3DTexture, RGFormat, Vector2, Vector3, DataTexture, HalfFloatType, DataUtils, LinearMipMapLinearFilter } from 'three';

import { CubeFace, FLOAT_NAN_REPLACEMENT_VALUE, FLOAT_NOT_LOADED_REPLACEMENT_VALUE, TILE_SIZE_2D, TILE_SIZE_3D, RGB_NOT_LOADED_ALPHA_VALUE, RGB_NAN_ALPHA_VALUE, DataType, NON_EXTREME_QUANTILE_INDEX, TILES_TEXTURE_NAME, QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME, NAN_FACTOR_MASK_NAN_VALUE, HALF_FLOAT_NAN_REPLACEMENT_VALUE, HALF_FLOAT_NOT_LOADED_REPLACEMENT_VALUE } from '../constants';
import { CubeClientContext } from '../client';
import { TileTextureView2DUpdateResult, TileTextureView3DUpdateResult } from '../rendering/tile-texture-views';
import { Tile2D, Tile3D } from '../core/tiles';

export class DataValue {
    value: number | Uint8Array;
    isDataNan: boolean | boolean[];
    isDataNotLoaded: boolean;

    constructor(v: {value: number | Uint8Array, isDataNan: boolean | boolean[], isDataNotLoaded: boolean}) {
        this.value = v.value;
        this.isDataNan = v.isDataNan;
        this.isDataNotLoaded = v.isDataNotLoaded;
    }
}

export class StorageUsage {
    cpuSideBytes: number;
    gpuSideBytes: number;

    constructor(cpuSideBytes: number, gpuSideBytes: number) {
        this.cpuSideBytes = cpuSideBytes;
        this.gpuSideBytes = gpuSideBytes;
    }

    static sum(usages: StorageUsage[]): StorageUsage {
        let totalCpuSideBytes = usages.reduce((sum, usage) => sum + usage.cpuSideBytes, 0);
        let totalGpuSideBytes = usages.reduce((sum, usage) => sum + usage.gpuSideBytes, 0);
        return new StorageUsage(totalCpuSideBytes, totalGpuSideBytes);
    }
}

export class TileStorage {
    // Storage arrays
    tile2dStoragesFloat!: Float32Array[][];
    tile3dStoragesFloat!: (Float32Array | Uint16Array)[];
    tile3dQuantileIndexStorages!: Uint8Array[];
    tileStoragesRgb!: Uint8Array[][];

    dataType = DataType.Float;

    // Download tracking
    private tiles2dDownloadFinished = new Array<Map<string, boolean>>();
    private tiles2dDownloadTriggered = new Array<Map<string, boolean>>();
    private tiles3dDownloadFinished = new Map<string, boolean>();
    private tiles3dDownloadTriggered = new Map<string, boolean>();
    tile2dDecodesFailed: number = 0;
    tile3dDecodesFailed: number = 0;

    maxCompressionErrors = new Map<string, number>();

    private tile2dStoragesAllocated!: Set<string>;
    totalBytesAllocatedFor2d: number = 0;

    private storages3dAllocated!: Set<string>;
    totalBytesAllocatedFor3d: number = 0;

    private textureFilteringEnabled: boolean;
    private useHalfFloatsForTile3d: boolean;

    private context: CubeClientContext;

    constructor(context: CubeClientContext) {
        this.context = context;
        this.textureFilteringEnabled = context.textureFilteringEnabled;
        this.useHalfFloatsForTile3d = context.useHalfFloatsForTile3d;
    }

    resetTextureFiltering() {
        this.toggleLinearTextureFiltering(this.context.textureFilteringEnabled);
    }

    // --- Storage allocation ---

    allocateTile2dStorages(forceStorageRecreation: boolean = false) {
        const storage = this.dataType == DataType.RGB ? this.tileStoragesRgb : this.tile2dStoragesFloat;
        if (!forceStorageRecreation && storage && storage.length > 1) {
            const notLoadedValue = this.dataType == DataType.RGB ? RGB_NOT_LOADED_ALPHA_VALUE : FLOAT_NOT_LOADED_REPLACEMENT_VALUE;
            for (let faceStorage of storage) {
                for (let lodStorage of faceStorage) {
                    lodStorage.fill(notLoadedValue);
                }
            }
            for (let face = 0; face < 6; face++) {
                const material = this.context.rendering.tile2dFaceRenderedCube.material[face];
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value.needsUpdate = true;
                }
            }
            this.context.log("Recycled existing textures and float32/uint8 arrays");
            return;
        }
        this.tile2dStoragesFloat = [];
        this.tileStoragesRgb = [];
        if (this.dataType == DataType.Float) {
            for (let face = 0; face < 6; face++) {
                this.tile2dStoragesFloat.push([]);
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    this.tile2dStoragesFloat[face].push(new Float32Array(0));
                }
            }
        } else if (this.dataType == DataType.RGB) {
            for (let face = 0; face < 6; face++) {
                this.tileStoragesRgb.push([]);
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    this.tileStoragesRgb[face].push(new Uint8Array(0));
                }
            }
        }
        this.tile2dStoragesAllocated = new Set<string>();
        this.totalBytesAllocatedFor2d = 0;
        this.context.log(`Reset tile storages`);
    }

    allocateTile3dStorages(forceStorageRecreation: boolean = false) {
        if (!forceStorageRecreation && this.tile3dStoragesFloat && this.tile3dStoragesFloat.length > 1) {
            const currentTextureUsesHalfFloat = this.tile3dStoragesFloat[0] instanceof Uint16Array;
            if (currentTextureUsesHalfFloat == this.useHalfFloatsForTile3d) {
                const notLoadedValue = this.useHalfFloatsForTile3d ? HALF_FLOAT_NOT_LOADED_REPLACEMENT_VALUE : FLOAT_NOT_LOADED_REPLACEMENT_VALUE;
                for (let lodStorage of this.tile3dStoragesFloat) {
                    lodStorage.fill(notLoadedValue);
                }
                for (let quantileAndNanFactorStorage of this.tile3dQuantileIndexStorages) {
                    quantileAndNanFactorStorage.fill(NON_EXTREME_QUANTILE_INDEX);
                }
                const material = this.context.rendering.tile3dVolumeRenderedCube.material;
                for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
                    material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value.needsUpdate = true;
                }
                this.context.log("Recycled existing textures and float32/uint8 arrays");
                return;
            }
        }
        this.tile3dStoragesFloat = [];
        this.tile3dQuantileIndexStorages = [];
        for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
            this.tile3dStoragesFloat.push(this.useHalfFloatsForTile3d ? new Uint16Array(0) : new Float32Array(0));
            this.tile3dQuantileIndexStorages.push(new Uint8Array(0));
        }
        this.storages3dAllocated = new Set<string>();
        this.totalBytesAllocatedFor3d = 0;
        this.context.log(`Reset tile storages`);
    }

    allocateTexture2d(face: CubeFace, lod: number) {
        const key = `2d-${face}-${lod}`
        if (this.tile2dStoragesAllocated.has(key)) {
            return;
        }
        this.tile2dStoragesAllocated.add(key);

        const material = this.context.rendering.tile2dFaceRenderedCube.material[face];
        if (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value) {
            (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value as Texture).dispose();
        }
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(face, lod);

        const totalTiles = ttvSizeInTiles.x * ttvSizeInTiles.y;
        const totalValues = (TILE_SIZE_2D * TILE_SIZE_2D) * totalTiles;
        const totalBytes = 4 * totalValues;
        if (this.dataType == DataType.RGB) {
            this.tileStoragesRgb[face][lod] = new Uint8Array(totalValues * 4);
            this.tileStoragesRgb[face][lod].fill(RGB_NOT_LOADED_ALPHA_VALUE);
        } else if (this.dataType == DataType.Float) {
            this.tile2dStoragesFloat[face][lod] = new Float32Array(totalValues);
            this.tile2dStoragesFloat[face][lod].fill(FLOAT_NOT_LOADED_REPLACEMENT_VALUE);
        }
        const storage = this.dataType == DataType.RGB ? this.tileStoragesRgb[face][lod] : this.tile2dStoragesFloat[face][lod];

        const texture = new DataTexture(storage, TILE_SIZE_2D * ttvSizeInTiles.x, TILE_SIZE_2D * ttvSizeInTiles.y);

        if (this.dataType == DataType.RGB) {
            texture.format = RGBAFormat;
            texture.type = UnsignedByteType;
        } else if (this.dataType == DataType.Float) {
            texture.format = RedFormat;
            texture.type = FloatType;
        }

        texture.name = `${TILES_TEXTURE_NAME}${lod}Face${face}`;
        texture.generateMipmaps = this.textureFilteringEnabled;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.magFilter = NearestFilter;
        texture.minFilter = this.textureFilteringEnabled ? LinearMipMapLinearFilter : NearestFilter;
        texture.anisotropy = this.textureFilteringEnabled ? 8 : 1;

        this.context.log("Creating texture with minFilter: ", texture.minFilter == NearestFilter ? "NearestFilter" : "LinearMipMapLinearFilter", "and anisotropy:", texture.anisotropy);
        material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value = texture;
        this.totalBytesAllocatedFor2d += totalBytes;
        this.context.log(`Allocated CPU-side tile storage for face ${CubeFace[face]}, LoD ${lod} (new: ${totalBytes / (1024 * 1024)} MB, total for 2D tiles: ${this.totalBytesAllocatedFor2d / (1024 * 1024)} MB)`)
    }

    isTexture3dAllocated(lod: number): boolean {
        const key = `3d-${lod}`;
        return this.storages3dAllocated.has(key);
    }

    get3dStorageType(): string {
        return this.useHalfFloatsForTile3d ? "float16" : "float32";
    }

    getActual3dStorageSizeOfLodInBytes(): StorageUsage {
        let usages = [];
        for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
            if (this.isTexture3dAllocated(lod)) {
                usages.push(this.getTheoretical3dStorageSizeOfLodInBytes(lod));
            }
        }
        return StorageUsage.sum(usages);
    }

    getTheoretical3dStorageSizeOfLodInBytes(lod: number): StorageUsage {
        const totalTiles = this.context.rendering.getTileTextureView3dSize(lod);
        const totalValues = (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) * totalTiles.x * totalTiles.y * totalTiles.z;
        const totalBytesForValueStorage = (this.useHalfFloatsForTile3d ? 2 : 4) * totalValues;
        const totalBytesForQuantileIndexAndNanFactorMaskStorage = 2 * totalValues;
        return new StorageUsage(totalBytesForValueStorage + totalBytesForQuantileIndexAndNanFactorMaskStorage, totalBytesForValueStorage);
    }

    allocateTexture3d(lod: number) {
        const key = `3d-${lod}`
        if (this.storages3dAllocated.has(key)) {
            return;
        }
        this.storages3dAllocated.add(key);

        const material = this.context.rendering.tile3dVolumeRenderedCube.material;
        if (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value) {
            (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value as Texture).dispose();
        }
        const totalTiles = this.context.rendering.getTileTextureView3dSize(lod);
        const totalValues = (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) * totalTiles.x * totalTiles.y * totalTiles.z;
        this.tile3dStoragesFloat[lod] = this.useHalfFloatsForTile3d ? new Uint16Array(totalValues) : new Float32Array(totalValues);
        this.tile3dStoragesFloat[lod].fill(this.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE);
        this.tile3dQuantileIndexStorages[lod] = new Uint8Array(totalValues);
        this.tile3dQuantileIndexStorages[lod].fill(NON_EXTREME_QUANTILE_INDEX);

        const dataTexture = new Data3DTexture(this.tile3dStoragesFloat[lod], totalTiles.x * TILE_SIZE_3D, totalTiles.y * TILE_SIZE_3D, totalTiles.z * TILE_SIZE_3D);
        this.context.log("AllocateTexture3D: 3d texture size", totalTiles.x * TILE_SIZE_3D, totalTiles.y * TILE_SIZE_3D, totalTiles.z * TILE_SIZE_3D, "with type", this.useHalfFloatsForTile3d ? "HalfFloatType" : "FloatType", ", element count", this.tile3dStoragesFloat[lod].length, "xtiles", totalTiles.x, "ytiles", totalTiles.y, "ztiles", totalTiles.z);
        dataTexture.format = RedFormat;
        dataTexture.type = this.useHalfFloatsForTile3d ? HalfFloatType : FloatType;
        dataTexture.minFilter = NearestFilter;
        dataTexture.magFilter = NearestFilter;
        material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value = dataTexture;

        // const quantileAndNanFactorMaskTexture = new Data3DTexture(this.tile3dQuantileIndexAndNanFactorStorages[lod], totalTiles.x * TILE_SIZE_3D, totalTiles.y * TILE_SIZE_3D, totalTiles.z * TILE_SIZE_3D);
        // quantileAndNanFactorMaskTexture.format = RGFormat;
        // quantileAndNanFactorMaskTexture.type = UnsignedByteType;
        // quantileAndNanFactorMaskTexture.minFilter = NearestFilter;
        // quantileAndNanFactorMaskTexture.magFilter = NearestFilter;
        // quantileAndNanFactorMaskTexture.wrapS = ClampToEdgeWrapping;
        // quantileAndNanFactorMaskTexture.wrapT = ClampToEdgeWrapping;
        // material.uniforms[`${QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME}${lod}`].value = quantileAndNanFactorMaskTexture;

        const totalBytes = (this.useHalfFloatsForTile3d ? 2 : 4) * totalValues + 2 * totalValues; // including quantile index and nan factor mask storage
        this.totalBytesAllocatedFor3d += totalBytes;
        this.context.log(`Allocated CPU-side 3D tile storage for LoD ${lod} (new: ${totalBytes / (1024 * 1024)} MB, total for 3D tiles: ${this.totalBytesAllocatedFor3d / (1024 * 1024)} MB)`)
    }

    // --- Put methods ---

    putNaNTile2dInStorage(tile: Tile2D) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(tile.face, tile.lod);
        const ttvOffsetInTiles = this.context.rendering.getTileTextureView2dOffsetInTiles(tile.face, tile.lod);

        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const targetStartIndex = (tile.x - ttvOffsetInTiles.x) * TILE_SIZE_2D + (tile.y - ttvOffsetInTiles.y) * indexIncrementPerRow * TILE_SIZE_2D;

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const targetRowStart = targetStartIndex + y * indexIncrementPerRow;
            this.tile2dStoragesFloat[tile.face][tile.lod].fill(FLOAT_NAN_REPLACEMENT_VALUE, targetRowStart, targetRowStart + TILE_SIZE_2D);
        }
    }

    patchTileValues(tile: Tile2D, values: Uint8Array | Float32Array | Float64Array, nanMask: ArrayBuffer | undefined, resampleResolution: number, replaceRealNans: boolean) {
        let anyNanToDisableLinearTextureFiltering = false;
        if (replaceRealNans && this.dataType == DataType.Float) {
            for (let i = 0; i < values.length; i++) {
                if (isNaN(values[i])) {
                    values[i] = FLOAT_NAN_REPLACEMENT_VALUE;
                }
            }
            if (this.textureFilteringEnabled) {
                anyNanToDisableLinearTextureFiltering = anyNanToDisableLinearTextureFiltering || values.some(v => isNaN(v));
            }
        }
        if (nanMask) {
            const nanValues = new Float32Array(nanMask);
            if (this.dataType == DataType.RGB) {
                for (let i = 0; i < nanValues.length; i++) {
                    if (nanValues[i] != 0) {
                        values[i * 4 + 3] = RGB_NAN_ALPHA_VALUE;
                    }
                }
            } else {
                for (let i = 0; i < nanValues.length; i++) {
                    if (nanValues[i] != 0) {
                        values[i] = FLOAT_NAN_REPLACEMENT_VALUE;
                    }
                }
            }
            if (this.textureFilteringEnabled) {
                anyNanToDisableLinearTextureFiltering = anyNanToDisableLinearTextureFiltering || nanValues.some(v => v != 0);
            }
        }

        const overflowing = this.applyOverflowingTileFix(tile, values, resampleResolution);

        if (anyNanToDisableLinearTextureFiltering && this.textureFilteringEnabled && !overflowing) {
            this.toggleLinearTextureFiltering();
        }
    }

    private applyOverflowingTileFix(tile: Tile2D, values: Uint8Array | Float32Array | Float64Array, resampleResolution: number = 1) {
        const overflowInfo = this.context.interaction.cubeDimensions.getOverflowEdgeTileInfo(tile);
        if (!overflowInfo.overflowing) {
            return;
        }
        const pixelFillAmount = (Math.pow(2, tile.lod) + 3) * resampleResolution;
        const resampleFactor = 1 / resampleResolution;
        if (resampleFactor != 1) {
            if (overflowInfo.overflowingX) {
                overflowInfo.xCutoff = Math.floor(overflowInfo.xCutoff * resampleFactor);
            }
            if (overflowInfo.overflowingY) {
                overflowInfo.yCutoff = Math.floor(overflowInfo.yCutoff * resampleFactor);
            }
        }

        const values32or64 = values instanceof Uint8Array ? new Uint32Array(values.buffer, values.byteOffset, values.length / 4) : values;

        if (overflowInfo.overflowingX) {
            const xMin = overflowInfo.xCutoff;
            for (let y = 0; y < Math.min(overflowInfo.yCutoff + pixelFillAmount, TILE_SIZE_2D); y++) {
                const value = values32or64[xMin - 1 + y * TILE_SIZE_2D];
                values32or64.set(Array(pixelFillAmount).fill(value), xMin + y * TILE_SIZE_2D);
            }
        }

        if (overflowInfo.overflowingY) {
            const yRowToCopy = overflowInfo.yCutoff - 1;
            const copiedRow = values32or64.slice(yRowToCopy * TILE_SIZE_2D, yRowToCopy * TILE_SIZE_2D + Math.min(overflowInfo.xCutoff + pixelFillAmount, TILE_SIZE_2D));
            for (let y = overflowInfo.yCutoff; y < Math.min(overflowInfo.yCutoff + pixelFillAmount, TILE_SIZE_2D); y++) {
                values32or64.set(copiedRow, y * TILE_SIZE_2D);
            }
        }
        return overflowInfo.overflowing;
    }

    parseAssertAndPatchTile2dData(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, resampleResolution: number = 1, replaceRealNans: boolean = false, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined): Uint8Array | Float32Array | Float64Array {
        const seemsLikeFloat64 = data.byteLength == (TILE_SIZE_2D * TILE_SIZE_2D * 8);
        const values = this.dataType == DataType.RGB ? new Uint8Array(data) : seemsLikeFloat64 ? new Float64Array(data) : new Float32Array(data);
        const expectedLength = this.dataType == DataType.RGB ? TILE_SIZE_2D * TILE_SIZE_2D * 4 : TILE_SIZE_2D * TILE_SIZE_2D;
        if (values.length != expectedLength) {
            console.warn(`Badly sized value array passed to putTile (${values.length} instead of ${TILE_SIZE_2D * TILE_SIZE_2D})`)
        }
        if (expectedDtype && values.constructor != expectedDtype) {
            console.error(`Badly typed value array passed to putTile (got ${values.constructor.name}, expected ${expectedDtype.name}) according to TILE_VERSION flags`)
        }
        this.patchTileValues(tile, values, nanMask, resampleResolution, replaceRealNans);

        return values;
    }

    putResampledTile2dInStorage(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, resampleResolution: number, replaceRealNans: boolean = false, storageTargetOverride?: Float32Array | Uint8Array, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        const values = this.parseAssertAndPatchTile2dData(tile, data, nanMask, resampleResolution, replaceRealNans, expectedDtype);

        if (this.dataType == DataType.RGB) {
            throw Error("RGB not implemented in putResampledTile2dInStorage :(")
        }

        const xPixelLeftoverOffset = (tile.x * TILE_SIZE_2D) % resampleResolution;
        const yPixelLeftoverOffset = (tile.y * TILE_SIZE_2D) % resampleResolution;

        const storageTarget = this.tile2dStoragesFloat[tile.face][tile.lod];

        const { startIndex, indexIncrementPerRow } = this.context.rendering.getTileTextureView2dTextureAccessParameters(tile);

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const targetRowStart = startIndex + y * indexIncrementPerRow;
            for (let x = 0; x < TILE_SIZE_2D; x++) {
                const accessX = Math.floor((x + xPixelLeftoverOffset) / resampleResolution);
                const accessY = Math.floor((y + yPixelLeftoverOffset) / resampleResolution);
                const accessIndex = accessX + accessY * TILE_SIZE_2D;
                storageTarget[targetRowStart + x] = values[accessIndex];
            }
        }
    }

    putTile2dInStorage(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, replaceRealNans: boolean = false, storageTargetOverride: Float32Array | undefined = undefined, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        const values = this.parseAssertAndPatchTile2dData(tile, data, nanMask, 1, replaceRealNans, expectedDtype);

        this.context.log("Putting 2d tile in storage:", tile.toString());
        if (storageTargetOverride) {
            storageTargetOverride.set(values, 0);
            return;
        }

        const accessFactor = this.dataType == DataType.RGB ? 4 : 1;
        const storageTarget = this.dataType == DataType.RGB ? this.tileStoragesRgb[tile.face][tile.lod] : this.tile2dStoragesFloat[tile.face][tile.lod];

        const { startIndex, indexIncrementPerRow } = this.context.rendering.getTileTextureView2dTextureAccessParameters(tile);

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const sourceRowStart = y * TILE_SIZE_2D;
            const targetRowStart = startIndex + y * indexIncrementPerRow;
            const sourceRow = values.subarray(sourceRowStart * accessFactor, (sourceRowStart + TILE_SIZE_2D) * accessFactor);
            storageTarget.set(sourceRow, targetRowStart * accessFactor);
        }
    }

    putTile3dInStorage(tile: Tile3D, data: ArrayBuffer, quantileIndexAndNanFactorMasks: ArrayBuffer, replaceRealNans: boolean = false, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        const seemsLikeFloat64 = data.byteLength == (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 8);
        const seemsLikeFloat32 = data.byteLength == (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 4);
        if (!seemsLikeFloat32 && !seemsLikeFloat64) {
            throw new Error(`Data length: ${data.byteLength} is neither the correct size for a Float32Array (${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 4}) nor a Float64Array (${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 8})`);
        }
        let values: Float32Array | Float64Array | Uint16Array = seemsLikeFloat64 ? new Float64Array(data) : new Float32Array(data);
        if (values.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) {
            console.error(`Badly sized value array passed to putTile (${values.length} instead of ${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D})`)
            return;
        }
        if (expectedDtype && values.constructor != expectedDtype) {
            console.error(`Badly typed value array passed to putTile (got ${values.constructor.name}, expected ${expectedDtype.name}) according to TILE_VERSION flags`)
            return;
        }

        if (this.useHalfFloatsForTile3d) {
            const halfFloatValues = new Uint16Array(TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
            for (let i = 0; i < values.length; i++) {
                halfFloatValues[i] = DataUtils.toHalfFloat(values[i]);
            }
            values = halfFloatValues;
        }

        const quantileIndexValues = new Uint8Array(quantileIndexAndNanFactorMasks, 0, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
        const nanFactorMaskValues = new Uint8Array(quantileIndexAndNanFactorMasks, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
        if (quantileIndexValues.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D || nanFactorMaskValues.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) {
            console.error(`Badly sized quantile index array / nan factor mask passed to putTile (${quantileIndexValues.length} / ${nanFactorMaskValues.length} instead of ${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D})`)
            return;
        }

        const replacementValue = this.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE;
        for (let i = 0; i < values.length; i++) {
            if (isNaN(values[i]) || nanFactorMaskValues[i] == NAN_FACTOR_MASK_NAN_VALUE) {
                values[i] = replacementValue;
            }
        }

        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice, tileInTtv } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const sourceIndex = localY * TILE_SIZE_3D + localZ * TILE_SIZE_3D * TILE_SIZE_3D;
                const targetIndexInTexture = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.tile3dStoragesFloat[tile.lod].set(values.subarray(sourceIndex, sourceIndex + TILE_SIZE_3D), targetIndexInTexture);

                // do not copy quantile index or nan mask into texture since:
                // 1. quantile indices are loaded separately now
                // 2. nan factor mask is not used in shader anymore, we use REPLACEMENT_VALUES as set above
            }
        }

        this.context.log("Put 3D tile in storage", tile, "startIndex in texture:", startIndex);
    }

    putQuantileIndexMaskInStorage(tile: Tile3D, quantileIndexMask: ArrayBuffer) {
        const quantileIndexValues = new Uint8Array(quantileIndexMask, 0, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
        
        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice, tileInTtv } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const sourceIndex = localY * TILE_SIZE_3D + localZ * TILE_SIZE_3D * TILE_SIZE_3D;
                const targetIndexInTexture = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.tile3dQuantileIndexStorages[tile.lod].set(quantileIndexValues.subarray(sourceIndex, sourceIndex + TILE_SIZE_3D), targetIndexInTexture);
            }
        }
    }

    putNaNTile3dInStorage(tile: Tile3D) {
        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice, tileInTtv } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        const replacementValue = this.useHalfFloatsForTile3d ?  HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE;
        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const index = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.tile3dStoragesFloat[tile.lod].fill(replacementValue, index, index + TILE_SIZE_3D);
            }
        }

        this.context.log("Put NaN tile in storage", tile);
    }

    // --- Texture update ---

    updateTextureForTile2d(tile: Tile2D) {
        this.context.rendering.tile2dFaceRenderedCube.material[tile.face].uniforms[`${TILES_TEXTURE_NAME}${tile.lod}`].value.needsUpdate = true;
    }

    updateTextureForTile3d(tile: Tile3D) {
        this.context.rendering.tile3dVolumeRenderedCube.material.uniforms[`${TILES_TEXTURE_NAME}${tile.lod}`].value.needsUpdate = true;
        // this.context.rendering.tile3dVolumeRenderedCube.material.uniforms[`${QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME}${tile.lod}`].value.needsUpdate = true;
    }

    // --- Download tracking ---

    totalTiles2dDownloadsTriggered(): number {
        return this.tiles2dDownloadTriggered.reduce((acc, map) => acc + map.size, 0);
    }

    totalTiles2dDownloadsFinished(): number {
        return this.tiles2dDownloadFinished.reduce((acc, map) => acc + map.size, 0);
    }

    totalTiles3dDownloadsTriggered(): number {
        return this.tiles3dDownloadTriggered.size;
    }

    totalTiles3dDownloadsFinished(): number {
        return this.tiles3dDownloadFinished.size;
    }

    isTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        if (tile instanceof Tile2D) {
            return this.tiles2dDownloadFinished[tile.face].get(tile.getHashKey());
        } else {
            return this.tiles3dDownloadFinished.get(tile.getHashKey());
        }
    }

    isTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        if (tile instanceof Tile2D) {
            return this.tiles2dDownloadTriggered[tile.face].get(tile.getHashKey());
        } else {
            return this.tiles3dDownloadTriggered.get(tile.getHashKey());
        }
    }

    setTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        if (tile instanceof Tile2D) {
            this.tiles2dDownloadTriggered[tile.face].set(tile.getHashKey(), true);
        } else {
            this.tiles3dDownloadTriggered.set(tile.getHashKey(), true);
        }
    }

    setTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        if (tile instanceof Tile2D) {
            if (!this.tiles2dDownloadTriggered[tile.face].has(tile.getHashKey())) {
                return;
            }
            this.tiles2dDownloadFinished[tile.face].set(tile.getHashKey(), true);
        } else {
            if (!this.tiles3dDownloadTriggered.has(tile.getHashKey())) {
                return;
            }
            this.tiles3dDownloadFinished.set(tile.getHashKey(), true);
        }
    }

    areTiles2dDownloadsCompleteForFace(face: CubeFace): boolean {
        return this.tiles2dDownloadTriggered[face].size == this.tiles2dDownloadFinished[face].size;
    }

    areTiles3dDownloadsComplete(): boolean {
        return this.tiles3dDownloadTriggered.size == this.tiles3dDownloadFinished.size;
    }

    // --- Reset methods ---

    resetTileMaps() {
        this.tile2dDecodesFailed = 0;
        this.maxCompressionErrors.clear();
        this.tiles2dDownloadTriggered.splice(0, this.tiles2dDownloadTriggered.length);
        this.tiles2dDownloadFinished.splice(0, this.tiles2dDownloadFinished.length);
        for (let i = 0; i < 6; i++) {
            this.tiles2dDownloadTriggered.push(new Map<string, boolean>());
            this.tiles2dDownloadFinished.push(new Map<string, boolean>());
        }
        this.tiles3dDownloadTriggered.clear();
        this.tiles3dDownloadFinished.clear();
    }

    resetTile2dDownloadMapsForFace(face: CubeFace) {
        this.tiles2dDownloadTriggered[face].clear();
        this.tiles2dDownloadFinished[face].clear();
    }

    resetTile3dDownloadMapsForLod(lod: number) {
        if (this.tile3dStoragesFloat && this.tile3dStoragesFloat.length > lod) {
            this.tile3dStoragesFloat[lod].fill(this.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE);
            this.tile3dQuantileIndexStorages[lod].fill(NAN_FACTOR_MASK_NAN_VALUE);
        }

        const keys = Array.from(this.tiles3dDownloadTriggered.keys());
        let reset = 0;
        for (let key of keys) {
            const l = parseInt(key.split("_")[0]);
            if (l == lod) {
                reset++;
                this.tiles3dDownloadTriggered.delete(key);
                this.tiles3dDownloadFinished.delete(key);
            }
        }
        this.tiles3dDownloadTriggered.clear();
        this.tiles3dDownloadFinished.clear();

        this.context.log(`Reset ${reset} 3d tile download maps for LoD ${lod} and filled storage with not-loaded values`);
    }

    resetTileDownloadMapsAfterTileTextureView2dUpdate(face: CubeFace, lod: number, previousOffset: Vector2) {
        for (const m of [this.tiles2dDownloadTriggered[face], this.tiles2dDownloadFinished[face]]) {
            m.forEach((v, k) => {
                const t = Tile2D.fromHashKey(this.context, k);
                if (t.lod == lod) {
                    if (!this.context.rendering.tileContainedInTileTextureView2d(t, previousOffset)) {
                        m.delete(k);
                    }
                }
            });
        }
    }

    resetTileDownloadMapsAfterTileTextureView3dUpdate(lod: number, previousOffset: Vector3) {
        for (const m of [this.tiles3dDownloadTriggered, this.tiles3dDownloadFinished]) {
            m.forEach((v, k) => {
                const t = Tile3D.fromHashKey(this.context, k);
                if (t.lod == lod) {
                    if (!this.context.rendering.tileContainedInTileTextureView3d(t, previousOffset)) {
                        m.delete(k);
                    }
                }
            });
        }
    }

    // --- Data access ---

    getTile2dDataValue(face: CubeFace, lod: number, tileX: number, tileY: number, pixelX: number, pixelY: number) {
        const accessedTile = new Tile2D(face, 0, lod, tileX, tileY, "", "");
        const { startIndex, indexIncrementPerRow, tileInTtv } = this.context.rendering.getTileTextureView2dTextureAccessParameters(accessedTile, pixelX, pixelY);

        if (!tileInTtv) {
            return new DataValue(
                {
                    value: NaN,
                    isDataNan: false,
                    isDataNotLoaded: true
                }
            );
        }

        if (this.dataType == DataType.RGB) {
            if (!this.tileStoragesRgb[face][lod] || this.tileStoragesRgb[face][lod].length == 0) {
                return new DataValue(
                    {
                        value: new Uint8Array(4).fill(RGB_NOT_LOADED_ALPHA_VALUE),
                        isDataNan: [false, false, false], 
                        isDataNotLoaded: true
                    }
                );
            }
            
            const v = this.tileStoragesRgb[face][lod].slice(startIndex * 4, (startIndex + 1) * 4);
            const alpha = v[3];
            const rValid = (alpha & 1) != 0;
            const gValid = (alpha & 2) != 0;
            const bValid = (alpha & 4) != 0;
            return new DataValue(
                {
                    value: v,
                    isDataNan: [!rValid, !gValid, !bValid],
                    isDataNotLoaded: v[3] == RGB_NOT_LOADED_ALPHA_VALUE
                }
            );
        } else {
            if (!this.tile2dStoragesFloat[face][lod] || this.tile2dStoragesFloat[face][lod].length == 0) {
                return new DataValue({
                        value: NaN,
                        isDataNan: false,
                        isDataNotLoaded: true
                    });
            }
            const value = this.tile2dStoragesFloat[face][lod][startIndex];
            return new DataValue({
                value: (value == FLOAT_NAN_REPLACEMENT_VALUE || value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE) ? NaN : value,
                isDataNan: value == FLOAT_NAN_REPLACEMENT_VALUE,
                isDataNotLoaded: value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE
            });
        }
    }

    getTile3dDataValue(lod: number, tileX: number, tileY: number, tileZ: number, pixelX: number, pixelY: number, pixelZ: number) {
        const accessedTile = new Tile3D(lod, tileX, tileY, tileZ, "", "");
        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice, tileInTtv } = this.context.rendering.getTileTextureView3dTextureAccessParameters(accessedTile, pixelX, pixelY, pixelZ);

        if (!tileInTtv) {
            return new DataValue(
                {
                    value: NaN,
                    isDataNan: false,
                    isDataNotLoaded: true
                }
            );
        }

        if (this.dataType == DataType.RGB) {
            throw new Error("RGB data type not supported for 3D tiles");
        }

        if (!this.tile3dStoragesFloat[lod] || this.tile3dStoragesFloat[lod].length == 0) {
            return new DataValue(
                {
                    value: NaN,
                    isDataNan: false,
                    isDataNotLoaded: true
                }
            );
        }

        const value = this.useHalfFloatsForTile3d ? DataUtils.fromHalfFloat(this.tile3dStoragesFloat[lod][startIndex]) : this.tile3dStoragesFloat[lod][startIndex];
        // const nanFactorMask = this.tile3dQuantileIndexAndNanFactorStorages[lod][2 * startIndex + 1];
        
        // half float is converted back to float before this check, so only comparison to FLOAT_... is valid here
        const isNan = value == FLOAT_NAN_REPLACEMENT_VALUE; 
        const isNotLoaded = value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE;

        return new DataValue({
            value: (isNan || isNotLoaded) ? NaN : value,
            isDataNan: isNan,
            isDataNotLoaded: isNotLoaded,
        });
    }

    // --- Tile copy/move ---

    moveTileStorageDataAfterTileTextureView3dUpdate(lod: number, updateResult: TileTextureView3DUpdateResult) {
        const ttvSize = updateResult.size;
        const offsetChange = updateResult.offset.clone().sub(updateResult.previousOffset);
        console.log("offset change", offsetChange, "(previous offset: ", updateResult.previousOffset, "new offset:", updateResult.offset, ") for LoD", lod);

        if (this.context.rendering.getOverflowForFace(CubeFace.Front).x) {
            const tilesOnFace = this.context.interaction.cubeDimensions.total3dTiles(lod);
            const offsetChangeCandidates = [offsetChange.x, offsetChange.x + tilesOnFace.x, offsetChange.x - tilesOnFace.x];
            const smallestAbsChange = offsetChangeCandidates.reduce((a, b) => Math.abs(b) < Math.abs(a) ? b : a);
            offsetChange.x = smallestAbsChange;
        }

        let copyOperations: Vector3[][] = [];
        let resetOperations: Vector3[] = [];
        for (let x = 0; x < ttvSize.x; x++) {
            for (let y = 0; y < ttvSize.y; y++) {
                for (let z = 0; z < ttvSize.z; z++) {
                    const targetPos = new Vector3(x, y, z);
                    const sourcePos = targetPos.clone().add(offsetChange);
                    if (sourcePos.x >= 0 && sourcePos.x < ttvSize.x && sourcePos.y >= 0 && sourcePos.y < ttvSize.y && sourcePos.z >= 0 && sourcePos.z < ttvSize.z) {
                        copyOperations.push([sourcePos, targetPos]);
                    } else {
                        resetOperations.push(targetPos);
                    }
                }
            }
        }

        const xOffsetChangeDirection = Math.sign(offsetChange.x);
        const yOffsetChangeDirection = Math.sign(offsetChange.y);
        const zOffsetChangeDirection = Math.sign(offsetChange.z);
        copyOperations.sort((a, b) => {
            let equality = 0;
            const xDifference = a[0].x - b[0].x;
            const yDifference = a[0].y - b[0].y;
            const zDifference = a[0].z - b[0].z;

            if (xOffsetChangeDirection < 0) {
                equality = Math.sign(xDifference);
            } else if (xOffsetChangeDirection > 0) {
                equality = -Math.sign(xDifference);
            }
            if (equality == 0) {
                if (yOffsetChangeDirection < 0) {
                    equality = Math.sign(yDifference);
                } else if (yOffsetChangeDirection > 0) {
                    equality = -Math.sign(yDifference);
                }
            }
            if (equality == 0) {
                if (zOffsetChangeDirection < 0) {
                    equality = Math.sign(zDifference);
                } else if (zOffsetChangeDirection > 0) {
                    equality = -Math.sign(zDifference);
                }
            }

            return -equality;
        });
        console.log("***** Moving tile storage data after TTV3D update, offsetChange:", offsetChange, "copy operations:", copyOperations, "reset operations", resetOperations);

        for (let i = 0; i < copyOperations.length; i++) {
            const c = copyOperations[i];
            this.copyDataBetweenTiles3d(lod, c[0], c[1], updateResult);
        }
        this.context.log("Finished moving storage data:", copyOperations.length, "tiles copied,", resetOperations.length, "tiles reset")
    }

    moveTileStorageDataAfterTileTextureView2dUpdate(face: CubeFace, lod: number, updateResult: TileTextureView2DUpdateResult) {
        const ttvSize = updateResult.size;
        const offsetChange = updateResult.offset.clone().sub(updateResult.previousOffset);
        console.log("offset change", offsetChange, "(previous offset: ", updateResult.previousOffset, "new offset:", updateResult.offset, ") for face", CubeFace[face], "LoD", lod);

        if (this.context.rendering.getOverflowForFace(face).x) {
            const tilesOnFace = this.context.interaction.cubeDimensions.tiles2dForFace(face, lod);
            const offsetChangeCandidates = [offsetChange.x, offsetChange.x + tilesOnFace.x, offsetChange.x - tilesOnFace.x];
            const smallestAbsChange = offsetChangeCandidates.reduce((a, b) => Math.abs(b) < Math.abs(a) ? b : a);
            offsetChange.x = smallestAbsChange;
        }

        let copyOperations: Vector2[][] = [];
        let resetOperations: Vector2[] = [];
        for (let x = 0; x < ttvSize.x; x++) {
            for (let y = 0; y < ttvSize.y; y++) {
                const targetPos = new Vector2(x, y);
                const sourcePos = targetPos.clone().add(offsetChange);
                if (sourcePos.x >= 0 && sourcePos.x < ttvSize.x && sourcePos.y >= 0 && sourcePos.y < ttvSize.y) {
                    copyOperations.push([sourcePos, targetPos]);
                } else {
                    resetOperations.push(targetPos);
                }
            }
        }

        const xOffsetChangeDirection = Math.sign(offsetChange.x);
        const yOffsetChangeDirection = Math.sign(offsetChange.y);
        copyOperations.sort((a, b) => {
            let equality = 0;
            const xDifference = a[0].x - b[0].x;
            const yDifference = a[0].y - b[0].y;

            if (xOffsetChangeDirection < 0) {
                equality = Math.sign(xDifference);
            } else if (xOffsetChangeDirection > 0) {
                equality = -Math.sign(xDifference);
            }
            if (equality == 0) {
                if (yOffsetChangeDirection < 0) {
                    equality = Math.sign(yDifference);
                } else if (yOffsetChangeDirection > 0) {
                    equality = -Math.sign(yDifference);
                }
            }

            return -equality;
        });
        if (face == CubeFace.Front) {
            console.log("***** sorting done, offset was", offsetChange, "copy operations:", copyOperations, "reset operations", resetOperations);
        }

        for (let i = 0; i < copyOperations.length; i++) {
            const c = copyOperations[i];
            this.copyDataBetweenTiles2d(face, lod, c[0], c[1], updateResult);
        }
        this.context.log("Finished moving storage data:", copyOperations.length, "tiles copied,", resetOperations.length, "tiles reset")
    }

    private copyDataBetweenTiles2d(face: CubeFace, lod: number, sourceTileTtvLocalCoords: Vector2, targetTileTtvLocalCoords: Vector2, updateResult: TileTextureView2DUpdateResult) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(face, lod);

        console.log(`Copying tile data FROM (${sourceTileTtvLocalCoords.x}, ${sourceTileTtvLocalCoords.y}) TO (${targetTileTtvLocalCoords.x}, ${targetTileTtvLocalCoords.y}) for face ${CubeFace[face]}, LoD ${lod}`)

        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const sourceStartIndex = (sourceTileTtvLocalCoords.x) * TILE_SIZE_2D + (sourceTileTtvLocalCoords.y) * indexIncrementPerRow * TILE_SIZE_2D;
        const targetStartIndex = (targetTileTtvLocalCoords.x) * TILE_SIZE_2D + (targetTileTtvLocalCoords.y) * indexIncrementPerRow * TILE_SIZE_2D;

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const sourceRowStart = sourceStartIndex + y * indexIncrementPerRow;
            const targetRowStart = targetStartIndex + y * indexIncrementPerRow;
            this.tile2dStoragesFloat[face][lod].copyWithin(targetRowStart, sourceRowStart, sourceRowStart + TILE_SIZE_2D);
        }
    }

    private copyDataBetweenTiles3d(lod: number, sourceTileTtvLocalCoords: Vector3, targetTileTtvLocalCoords: Vector3, updateResult: TileTextureView3DUpdateResult) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView3dSize(lod);

        console.log(`Copying 3d tile data FROM (${sourceTileTtvLocalCoords.x}, ${sourceTileTtvLocalCoords.y}, ${sourceTileTtvLocalCoords.z}) TO (${targetTileTtvLocalCoords.x}, ${targetTileTtvLocalCoords.y}, ${targetTileTtvLocalCoords.z}) for LoD ${lod}`)

        const indexIncrementPerPixelRow = ttvSizeInTiles.x * TILE_SIZE_3D;
        const indexIncrementPerPixelSlice = ttvSizeInTiles.y * indexIncrementPerPixelRow * TILE_SIZE_3D;

        const sourceStartIndex = sourceTileTtvLocalCoords.x * TILE_SIZE_3D
            + sourceTileTtvLocalCoords.y * indexIncrementPerPixelRow * TILE_SIZE_3D
            + sourceTileTtvLocalCoords.z * indexIncrementPerPixelSlice * TILE_SIZE_3D;

        const targetStartIndex = targetTileTtvLocalCoords.x * TILE_SIZE_3D
            + targetTileTtvLocalCoords.y * indexIncrementPerPixelRow * TILE_SIZE_3D
            + targetTileTtvLocalCoords.z * indexIncrementPerPixelSlice * TILE_SIZE_3D;

        for (let z = 0; z < TILE_SIZE_3D; z++) {
            for (let y = 0; y < TILE_SIZE_3D; y++) {
                const sourceRowStart = sourceStartIndex + y * indexIncrementPerPixelRow + z * indexIncrementPerPixelSlice;
                const targetRowStart = targetStartIndex + y * indexIncrementPerPixelRow + z * indexIncrementPerPixelSlice;
                this.tile3dStoragesFloat[lod].copyWithin(targetRowStart, sourceRowStart, sourceRowStart + TILE_SIZE_3D);
                this.tile3dQuantileIndexStorages[lod].copyWithin(targetRowStart * 2, sourceRowStart * 2, (sourceRowStart + TILE_SIZE_3D) * 2);
            }
        }
    }

    private resetDataInStorage2d(face: CubeFace, lod: number, targetTileTtvLocalCoords: Vector2) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(face, lod);

        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const targetStartIndex = (targetTileTtvLocalCoords.x) * TILE_SIZE_2D + (targetTileTtvLocalCoords.y) * indexIncrementPerRow * TILE_SIZE_2D;

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const targetRowStart = targetStartIndex + y * indexIncrementPerRow;
            this.tile2dStoragesFloat[face][lod].fill(FLOAT_NOT_LOADED_REPLACEMENT_VALUE, targetRowStart, targetRowStart + TILE_SIZE_2D);
        }
    }

    // --- Linear texture filtering ---

    private toggleLinearTextureFiltering(enabled: boolean = false) {
        if (this.textureFilteringEnabled == enabled) {
            return;
        }
        this.textureFilteringEnabled = enabled;
        this.context.log(`Setting linear texture filtering on all textures: ${enabled}`);

        for (let face = 0; face < 6; face++) {
            for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                const material = this.context.rendering.tile2dFaceRenderedCube.material[face];
                const texture = material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value as DataTexture;
                if (!texture) {
                    continue;
                }
                texture.minFilter = enabled ? LinearMipMapLinearFilter : NearestFilter;
                texture.anisotropy = enabled ? 8 : 1;
                texture.generateMipmaps = enabled;
                texture.needsUpdate = true;
            }
        }
    }

    // --- Data type ---

    setDataType(valueType: DataType) {
        this.dataType = valueType;
        this.context.log("Set data value type to", DataType[valueType]);
    }
}
