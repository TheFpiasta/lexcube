import { Vector2, Vector3 } from 'three';
import { CubeFace, positiveModulo, TILE_SIZE_2D, TILE_SIZE_3D } from '../constants';
import { CubeDimensions } from '../core/dimensions';
import { CubeSelection } from '../core/selection';
import { Parameter } from '../core/parameters';
import { Tile2D, Tile3D, TileData } from '../tiledata';
import { CubeRendering } from '../rendering';
import { DataValue } from '../services/tile/storage';
import type { CubeInteraction } from '../interaction';

export class PickedDataValue {
    face: CubeFace | undefined;
    dataValue: number | Uint8Array;
    isDataValueNotLoaded: boolean;
    isDataNan: boolean | boolean[];
    x: number;
    y: number;
    z: number;
    lod: number;
    tileX: number;
    tileY: number;
    tileZ: number | undefined;
    localTilePixelX: number;
    localTilePixelY: number;
    localTilePixelZ: number | undefined;
    maximumCompressionError: number | undefined;

    constructor() {
        this.dataValue = 0;
        this.isDataValueNotLoaded = false;
        this.isDataNan = false;
        this.y = 0;
        this.x = 0;
        this.z = 0;
        this.lod = 0;
        this.tileX = 0;
        this.tileY = 0;
        this.localTilePixelX = 0;
        this.localTilePixelY = 0;
        this.maximumCompressionError = 0;
    }

    setFrom2dTileData(cubeSelection: CubeSelection, cubeDimensions: CubeDimensions, rendering: CubeRendering, tileData: TileData, selectedCubeId: string, selectedParameterId: string, face: number, uv: Vector2) {
        const offset = cubeSelection.getDisplayOffsetVector2d(face).clone();
        const size = cubeSelection.getDisplaySizeVector2d(face).clone();
        const hoverPosition = size.multiply(uv).add(offset);
        hoverPosition.x = positiveModulo(hoverPosition.x, cubeDimensions.totalWidthForFace(face));
        const lod = rendering.lods2d[face];

        const lodAdjustedTileSize = (Math.pow(2, lod) * TILE_SIZE_2D);
        const tileX = Math.floor(hoverPosition.x / lodAdjustedTileSize);
        const tileY = Math.floor(hoverPosition.y / lodAdjustedTileSize);
        const uvWithinTileX = (hoverPosition.x % lodAdjustedTileSize) / lodAdjustedTileSize;
        const uvWithinTileY = (hoverPosition.y % lodAdjustedTileSize) / lodAdjustedTileSize;
        const pixelX = Math.floor(uvWithinTileX * TILE_SIZE_2D);
        const pixelY = Math.floor(uvWithinTileY * TILE_SIZE_2D);
        const dv = tileData.getTile2dDataValue(face, lod, tileX, tileY, pixelX, pixelY);

        this.x = (face <= 3) ? hoverPosition.x : cubeSelection.getGuaranteedSparsityValidIndexValueForFace(face);
        this.y = (face > 3) ? hoverPosition.x : ((face <= 1) ? hoverPosition.y : cubeSelection.getGuaranteedSparsityValidIndexValueForFace(face));
        this.z = (face > 1) ? hoverPosition.y : cubeSelection.getGuaranteedSparsityValidIndexValueForFace(face);
        this.face = face;
        this.tileX = tileX;
        this.tileY = tileY;
        this.tileZ = undefined;
        this.localTilePixelX = pixelX;
        this.localTilePixelY = pixelY;
        this.localTilePixelZ = undefined;
        this.lod = lod;

        const tile = new Tile2D(face, (face <= 1 ? this.z : (face <= 3 ? this.y : this.x)), lod, tileX, tileY, selectedCubeId, selectedParameterId);

        return this.setFromDataValue(tileData, dv, tile);
    }

    setFrom3dTileData(globalVoxelPosition: Vector3, lod: number, cubeDimensions: CubeDimensions, tileData: TileData, selectedCubeId: string, selectedParameterId: string) {
        globalVoxelPosition.x = positiveModulo(globalVoxelPosition.x, cubeDimensions.totalWidthForFace(CubeFace.Front));

        const lodAdjustedTileSize = (Math.pow(2, lod) * TILE_SIZE_3D);
        const tileCoords = globalVoxelPosition.clone().divideScalar(lodAdjustedTileSize).floor();
        const uvWithinTile = globalVoxelPosition.clone().divideScalar(lodAdjustedTileSize);
        uvWithinTile.sub(uvWithinTile.clone().floor());
        const pixelWithinTileCoords = uvWithinTile.clone().multiplyScalar(TILE_SIZE_3D).floor();
        const dv = tileData.getTile3dDataValue(lod, tileCoords.x, tileCoords.y, tileCoords.z, pixelWithinTileCoords.x, pixelWithinTileCoords.y, pixelWithinTileCoords.z);

        this.x = globalVoxelPosition.x;
        this.y = globalVoxelPosition.y;
        this.z = globalVoxelPosition.z;
        this.face = undefined;
        this.tileX = tileCoords.x;
        this.tileY = tileCoords.y;
        this.tileZ = tileCoords.z;
        this.localTilePixelX = pixelWithinTileCoords.x;
        this.localTilePixelY = pixelWithinTileCoords.y;
        this.localTilePixelZ = pixelWithinTileCoords.z;
        this.lod = lod;

        const tile = new Tile3D(lod, tileCoords.x, tileCoords.y, tileCoords.z, selectedCubeId, selectedParameterId);

        this.setFromDataValue(tileData, dv, tile);
    }

    isFrom3d() {
        const is3d = this.tileZ !== undefined && this.localTilePixelZ !== undefined && this.face === undefined;
        const is2d = this.tileZ === undefined && this.localTilePixelZ === undefined && this.face !== undefined;
        if (!is3d && !is2d) {
            console.error("PickedDataValue is neither from 2d nor 3d tile data. This should not happen.");
        }
        return is3d;
    }

    private setFromDataValue(tileData: TileData, dv: DataValue, tile: Tile2D | Tile3D) {
        this.maximumCompressionError = tileData.maxCompressionErrors.get(tile.getHashKey());

        this.dataValue = dv.value;
        this.isDataValueNotLoaded = dv.isDataNotLoaded;
        this.isDataNan = dv.isDataNan;

        return this;
    }

    getString(cubeInteraction: CubeInteraction, selectedParameter: Parameter, prefix: string = "") {
        if (this.isDataValueNotLoaded) {
            return `${prefix}Data not yet loaded`;
        } else if (typeof this.dataValue === "number") {
            if (isNaN(this.dataValue) || this.isDataNan) {
                return `${prefix}No Data`;
            } else {
                const value = `${cubeInteraction.toFixed(selectedParameter.getConvertedDataValue(this.dataValue))}`;
                return `${prefix}${value} ${selectedParameter.getUnitHTML()}`;
            }
        } else if (this.dataValue instanceof Uint8Array) {
            const lines = selectedParameter.getRgbDataValueString(this.dataValue, this.isDataNan);
            return lines;
        }
        return "No valid string for picked data value.";
    }
}
