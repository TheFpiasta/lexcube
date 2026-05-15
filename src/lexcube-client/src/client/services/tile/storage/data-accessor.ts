import { DataUtils } from 'three';
import {
    CubeFace, FLOAT_NAN_REPLACEMENT_VALUE, FLOAT_NOT_LOADED_REPLACEMENT_VALUE,
    RGB_NOT_LOADED_ALPHA_VALUE, DataType, TILES_TEXTURE_NAME
} from '../../../constants';
import { CubeClientContext } from '../../../client';
import { Tile2D, Tile3D } from '../../../core/tiles';
import { DataValue } from './types';
import type { TileStorage } from '.';

export class TileDataAccessor {
    private context: CubeClientContext;
    private host: TileStorage;

    constructor(context: CubeClientContext, host: TileStorage) {
        this.context = context;
        this.host = host;
    }

    getTile2dDataValue(face: CubeFace, lod: number, tileX: number, tileY: number, pixelX: number, pixelY: number) {
        const accessedTile = new Tile2D(face, 0, lod, tileX, tileY, "", "");
        const { startIndex, tileInTtv } = this.context.rendering.getTileTextureView2dTextureAccessParameters(accessedTile, pixelX, pixelY);

        if (!tileInTtv) {
            return new DataValue({
                value: NaN,
                isDataNan: false,
                isDataNotLoaded: true
            });
        }

        if (this.host.dataType == DataType.RGB) {
            if (!this.host.tileStoragesRgb[face][lod] || this.host.tileStoragesRgb[face][lod].length == 0) {
                return new DataValue({
                    value: new Uint8Array(4).fill(RGB_NOT_LOADED_ALPHA_VALUE),
                    isDataNan: [false, false, false],
                    isDataNotLoaded: true
                });
            }

            const v = this.host.tileStoragesRgb[face][lod].slice(startIndex * 4, (startIndex + 1) * 4);
            const alpha = v[3];
            const rValid = (alpha & 1) != 0;
            const gValid = (alpha & 2) != 0;
            const bValid = (alpha & 4) != 0;
            return new DataValue({
                value: v,
                isDataNan: [!rValid, !gValid, !bValid],
                isDataNotLoaded: v[3] == RGB_NOT_LOADED_ALPHA_VALUE
            });
        } else {
            if (!this.host.tile2dStoragesFloat[face][lod] || this.host.tile2dStoragesFloat[face][lod].length == 0) {
                return new DataValue({
                    value: NaN,
                    isDataNan: false,
                    isDataNotLoaded: true
                });
            }
            const value = this.host.tile2dStoragesFloat[face][lod][startIndex];
            return new DataValue({
                value: (value == FLOAT_NAN_REPLACEMENT_VALUE || value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE) ? NaN : value,
                isDataNan: value == FLOAT_NAN_REPLACEMENT_VALUE,
                isDataNotLoaded: value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE
            });
        }
    }

    getTile3dDataValue(lod: number, tileX: number, tileY: number, tileZ: number, pixelX: number, pixelY: number, pixelZ: number) {
        const accessedTile = new Tile3D(lod, tileX, tileY, tileZ, "", "");
        const { startIndex, tileInTtv } = this.context.rendering.getTileTextureView3dTextureAccessParameters(accessedTile, pixelX, pixelY, pixelZ);

        if (!tileInTtv) {
            return new DataValue({
                value: NaN,
                isDataNan: false,
                isDataNotLoaded: true
            });
        }

        if (this.host.dataType == DataType.RGB) {
            throw new Error("RGB data type not supported for 3D tiles");
        }

        if (!this.host.tile3dStoragesFloat[lod] || this.host.tile3dStoragesFloat[lod].length == 0) {
            return new DataValue({
                value: NaN,
                isDataNan: false,
                isDataNotLoaded: true
            });
        }

        const value = this.host.useHalfFloatsForTile3d
            ? DataUtils.fromHalfFloat(this.host.tile3dStoragesFloat[lod][startIndex])
            : this.host.tile3dStoragesFloat[lod][startIndex];

        const isNan = value == FLOAT_NAN_REPLACEMENT_VALUE;
        const isNotLoaded = value == FLOAT_NOT_LOADED_REPLACEMENT_VALUE;

        return new DataValue({
            value: (isNan || isNotLoaded) ? NaN : value,
            isDataNan: isNan,
            isDataNotLoaded: isNotLoaded,
        });
    }

    updateTextureForTile2d(tile: Tile2D) {
        this.context.rendering.tile2dFaceRenderedCube.material[tile.face].uniforms[`${TILES_TEXTURE_NAME}${tile.lod}`].value.needsUpdate = true;
    }

    updateTextureForTile3d(tile: Tile3D) {
        this.context.rendering.tile3dVolumeRenderedCube.material.uniforms[`${TILES_TEXTURE_NAME}${tile.lod}`].value.needsUpdate = true;
    }
}
