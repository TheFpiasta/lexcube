import { DataUtils } from 'three';
import {
    FLOAT_NAN_REPLACEMENT_VALUE, TILE_SIZE_2D, TILE_SIZE_3D,
    RGB_NAN_ALPHA_VALUE, DataType, NAN_FACTOR_MASK_NAN_VALUE,
    HALF_FLOAT_NAN_REPLACEMENT_VALUE
} from '../../../constants';
import { CubeClientContext } from '../../../client';
import { Tile2D, Tile3D } from '../../../core/tiles';
import type { TileStorage } from '.';

export class TileDataPatcher {
    private context: CubeClientContext;
    private host: TileStorage;

    constructor(context: CubeClientContext, host: TileStorage) {
        this.context = context;
        this.host = host;
    }

    putNaNTile2dInStorage(tile: Tile2D) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(tile.face, tile.lod);
        const ttvOffsetInTiles = this.context.rendering.getTileTextureView2dOffsetInTiles(tile.face, tile.lod);

        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const targetStartIndex = (tile.x - ttvOffsetInTiles.x) * TILE_SIZE_2D + (tile.y - ttvOffsetInTiles.y) * indexIncrementPerRow * TILE_SIZE_2D;

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const targetRowStart = targetStartIndex + y * indexIncrementPerRow;
            this.host.tile2dStoragesFloat[tile.face][tile.lod].fill(FLOAT_NAN_REPLACEMENT_VALUE, targetRowStart, targetRowStart + TILE_SIZE_2D);
        }
    }

    patchTileValues(tile: Tile2D, values: Uint8Array | Float32Array | Float64Array, nanMask: ArrayBuffer | undefined, resampleResolution: number, replaceRealNans: boolean) {
        let anyNanToDisableLinearTextureFiltering = false;
        if (replaceRealNans && this.host.dataType == DataType.Float) {
            for (let i = 0; i < values.length; i++) {
                if (isNaN(values[i])) {
                    values[i] = FLOAT_NAN_REPLACEMENT_VALUE;
                }
            }
            if (this.host.textureFilteringEnabled) {
                anyNanToDisableLinearTextureFiltering = anyNanToDisableLinearTextureFiltering || values.some(v => isNaN(v));
            }
        }
        if (nanMask) {
            const nanValues = new Float32Array(nanMask);
            if (this.host.dataType == DataType.RGB) {
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
            if (this.host.textureFilteringEnabled) {
                anyNanToDisableLinearTextureFiltering = anyNanToDisableLinearTextureFiltering || nanValues.some(v => v != 0);
            }
        }

        const overflowing = this.applyOverflowingTileFix(tile, values, resampleResolution);

        if (anyNanToDisableLinearTextureFiltering && this.host.textureFilteringEnabled && !overflowing) {
            this.host.toggleLinearTextureFiltering(false);
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
        const values = this.host.dataType == DataType.RGB ? new Uint8Array(data) : seemsLikeFloat64 ? new Float64Array(data) : new Float32Array(data);
        const expectedLength = this.host.dataType == DataType.RGB ? TILE_SIZE_2D * TILE_SIZE_2D * 4 : TILE_SIZE_2D * TILE_SIZE_2D;
        if (values.length != expectedLength) {
            console.warn(`Badly sized value array passed to putTile (${values.length} instead of ${TILE_SIZE_2D * TILE_SIZE_2D})`);
        }
        if (expectedDtype && values.constructor != expectedDtype) {
            console.error(`Badly typed value array passed to putTile (got ${values.constructor.name}, expected ${expectedDtype.name}) according to TILE_VERSION flags`);
        }
        this.patchTileValues(tile, values, nanMask, resampleResolution, replaceRealNans);

        return values;
    }

    putResampledTile2dInStorage(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, resampleResolution: number, replaceRealNans: boolean = false, _storageTargetOverride?: Float32Array | Uint8Array, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        const values = this.parseAssertAndPatchTile2dData(tile, data, nanMask, resampleResolution, replaceRealNans, expectedDtype);

        if (this.host.dataType == DataType.RGB) {
            throw Error("RGB not implemented in putResampledTile2dInStorage :(");
        }

        const xPixelLeftoverOffset = (tile.x * TILE_SIZE_2D) % resampleResolution;
        const yPixelLeftoverOffset = (tile.y * TILE_SIZE_2D) % resampleResolution;

        const storageTarget = this.host.tile2dStoragesFloat[tile.face][tile.lod];

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

        const accessFactor = this.host.dataType == DataType.RGB ? 4 : 1;
        const storageTarget = this.host.dataType == DataType.RGB ? this.host.tileStoragesRgb[tile.face][tile.lod] : this.host.tile2dStoragesFloat[tile.face][tile.lod];

        const { startIndex, indexIncrementPerRow } = this.context.rendering.getTileTextureView2dTextureAccessParameters(tile);

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const sourceRowStart = y * TILE_SIZE_2D;
            const targetRowStart = startIndex + y * indexIncrementPerRow;
            const sourceRow = values.subarray(sourceRowStart * accessFactor, (sourceRowStart + TILE_SIZE_2D) * accessFactor);
            storageTarget.set(sourceRow, targetRowStart * accessFactor);
        }
    }

    putTile3dInStorage(tile: Tile3D, data: ArrayBuffer, quantileIndexAndNanFactorMasks: ArrayBuffer, _replaceRealNans: boolean = false, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        const seemsLikeFloat64 = data.byteLength == (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 8);
        const seemsLikeFloat32 = data.byteLength == (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 4);
        if (!seemsLikeFloat32 && !seemsLikeFloat64) {
            throw new Error(`Data length: ${data.byteLength} is neither the correct size for a Float32Array (${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 4}) nor a Float64Array (${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D * 8})`);
        }
        let values: Float32Array | Float64Array | Uint16Array = seemsLikeFloat64 ? new Float64Array(data) : new Float32Array(data);
        if (values.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) {
            console.error(`Badly sized value array passed to putTile (${values.length} instead of ${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D})`);
            return;
        }
        if (expectedDtype && values.constructor != expectedDtype) {
            console.error(`Badly typed value array passed to putTile (got ${values.constructor.name}, expected ${expectedDtype.name}) according to TILE_VERSION flags`);
            return;
        }

        if (this.host.useHalfFloatsForTile3d) {
            const halfFloatValues = new Uint16Array(TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
            for (let i = 0; i < values.length; i++) {
                halfFloatValues[i] = DataUtils.toHalfFloat(values[i]);
            }
            values = halfFloatValues;
        }

        const quantileIndexValues = new Uint8Array(quantileIndexAndNanFactorMasks, 0, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
        const nanFactorMaskValues = new Uint8Array(quantileIndexAndNanFactorMasks, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);
        if (quantileIndexValues.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D || nanFactorMaskValues.length != TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) {
            console.error(`Badly sized quantile index array / nan factor mask passed to putTile (${quantileIndexValues.length} / ${nanFactorMaskValues.length} instead of ${TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D})`);
            return;
        }

        const replacementValue = this.host.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE;
        for (let i = 0; i < values.length; i++) {
            if (isNaN(values[i]) || nanFactorMaskValues[i] == NAN_FACTOR_MASK_NAN_VALUE) {
                values[i] = replacementValue;
            }
        }

        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const sourceIndex = localY * TILE_SIZE_3D + localZ * TILE_SIZE_3D * TILE_SIZE_3D;
                const targetIndexInTexture = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.host.tile3dStoragesFloat[tile.lod].set(values.subarray(sourceIndex, sourceIndex + TILE_SIZE_3D), targetIndexInTexture);
            }
        }

        this.context.log("Put 3D tile in storage", tile, "startIndex in texture:", startIndex);
    }

    putQuantileIndexMaskInStorage(tile: Tile3D, quantileIndexMask: ArrayBuffer) {
        const quantileIndexValues = new Uint8Array(quantileIndexMask, 0, TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D);

        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const sourceIndex = localY * TILE_SIZE_3D + localZ * TILE_SIZE_3D * TILE_SIZE_3D;
                const targetIndexInTexture = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.host.tile3dQuantileIndexStorages[tile.lod].set(quantileIndexValues.subarray(sourceIndex, sourceIndex + TILE_SIZE_3D), targetIndexInTexture);
            }
        }
    }

    putNaNTile3dInStorage(tile: Tile3D) {
        const { startIndex, indexIncrementPerRow, indexIncrementPerSlice } = this.context.rendering.getTileTextureView3dTextureAccessParameters(tile);

        const replacementValue = this.host.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE;
        for (let localZ = 0; localZ < TILE_SIZE_3D; localZ++) {
            for (let localY = 0; localY < TILE_SIZE_3D; localY++) {
                const index = startIndex + localY * indexIncrementPerRow + localZ * indexIncrementPerSlice;
                this.host.tile3dStoragesFloat[tile.lod].fill(replacementValue, index, index + TILE_SIZE_3D);
            }
        }

        this.context.log("Put NaN tile in storage", tile);
    }
}
