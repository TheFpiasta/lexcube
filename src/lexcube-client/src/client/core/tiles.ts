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

/**
 * Tile coordinate logic extracted from tiledata.ts
 *
 * This module contains:
 * - Tile2D: 2D tile coordinate calculations and request data
 * - Tile3D: 3D tile coordinate calculations and request data
 * - Tile3DClipBoundary: Clip boundary calculations for 3D tiles
 */

import { CubeFace, Dimension, TILE_FORMAT_ZFP, TILE_TYPE_2D } from '../constants';
import type { CubeClientContext } from '../client';

export class Tile2D {
    static fromResponseData(metadata: any): Tile2D[] {
        const tiles = [];
        for (let xy of metadata.xys) {
            tiles.push(new Tile2D(metadata.face, metadata.indexValue, metadata.lod, xy[0], xy[1], metadata.datasetId, metadata.parameter))
        }
        return tiles;
    }

    static fromHashKey(context: CubeClientContext, key: string): Tile2D {
        const s = key.split("_");
        return new Tile2D(Number(s[0]), Number(s[1]), Number(s[2]), Number(s[3]), Number(s[4]), context.interaction.selectedCube.id, context.interaction.selectedParameterId);
    }

    constructor(face: CubeFace, indexValue: number, lod: number, tileX: number, tileY: number, cubeId: string, parameter: string) {
        this.cubeId = cubeId;
        this.parameter = parameter;
        this.face = face;
        this.indexValue = indexValue;
        this.lod = lod;
        this.x = tileX;
        this.y = tileY;
    }

    getRequestGroupKey() {
        return `${this.cubeId}-${this.parameter}-${this.indexDimension()}-${this.indexValue}`;
    }

    toString() {
        return `${CubeFace[this.face]} LoD: ${this.lod} TileX: ${this.x} TileY: ${this.y}`;
    }

    indexDimension() {
        return (this.face <= 1 ? Dimension.Z : (this.face <= 3 ? Dimension.Y : Dimension.X));
    }

    getRequestData() {
        return {
            tileType: TILE_TYPE_2D,
            face: this.face,
            datasetId: this.cubeId,
            parameter: this.parameter,
            indexDimension: `by_${Dimension[this.indexDimension()].toLowerCase()}`,
            indexValue: this.indexValue,
            lod: this.lod,
            tileX: this.x,
            tileY: this.y
        }
    }

    getRequestDataWithMultipleXYs(xys: number[][]) {
        return {
            tileType: TILE_TYPE_2D,
            tileFormat: TILE_FORMAT_ZFP,
            face: this.face,
            datasetId: this.cubeId,
            parameter: this.parameter,
            indexDimension: `by_${Dimension[this.indexDimension()].toLowerCase()}`,
            indexValue: this.indexValue,
            lod: this.lod,
            xys: xys,
        }
    }

    getHashKey() {
        return `${this.face}_${this.indexValue}_${this.lod}_${this.x}_${this.y}_${this.cubeId}_${this.parameter}`;
    }

    cubeId: string;
    parameter: string;
    face: CubeFace;
    indexValue: number;
    lod: number;
    x: number;
    y: number;
}


export class Tile3D {
    static fromResponseData(metadata: any): Tile3D[] {
        const tiles = [];
        const indexMaskEventName = metadata.indexMaskEventType ? `${metadata.quantileIndexMaskEventName}_${metadata.lod}` : null;
        for (let xyz of metadata.xyzs) {
            tiles.push(new Tile3D(metadata.lod, xyz[0], xyz[1], xyz[2], metadata.datasetId, metadata.parameter, indexMaskEventName))
        }
        return tiles;
    }

    static fromHashKey(context: CubeClientContext, key: string): Tile3D {
        const s = key.split("_");
        return new Tile3D(Number(s[0]), Number(s[1]), Number(s[2]), Number(s[3]), context.interaction.selectedCube.id, context.interaction.selectedParameterId, s.length > 7 ? s[7] : null);
    }

    getHashKey() {
        return `${this.lod}_${this.x}_${this.y}_${this.z}_${this.cubeId}_${this.parameter}${this.indexMaskEventType ? ("_" + this.indexMaskEventType) : ""}`;
    }

    constructor(lod: number, tileX: number, tileY: number, tileZ: number, cubeId: string, parameter: string, indexMaskEventName: string | null = null) {
        this.cubeId = cubeId;
        this.parameter = parameter;
        this.lod = lod;
        this.x = tileX;
        this.y = tileY;
        this.z = tileZ;
        this.indexMaskEventType = indexMaskEventName;
    }

    isIndexMask() {
        return this.indexMaskEventType !== null;
    }

    getRequestGroupKey() {
        return `${this.cubeId}-${this.parameter}-${this.lod}-${this.z}`;
    }

    toString() {
        return `Tile3D LoD: ${this.lod} TileX: ${this.x} TileY: ${this.y} TileZ: ${this.z} IndexMaskEventType: ${this.indexMaskEventType}`;
    }

    getRequestData() {
        let r: any = {
            tileType: "3d",
            tileFormat: TILE_FORMAT_ZFP,
            datasetId: this.cubeId,
            parameter: this.parameter,
            lod: this.lod,
            tileX: this.x,
            tileY: this.y,
            tileZ: this.z
        }
        if (this.indexMaskEventType) {
            r["indexMaskEventType"] = this.indexMaskEventType;
        }
        return r;
    }

    getRequestDataWithMultipleXYs(xyzs: number[][]) {
        let r: any = {
            tileType: "3d",
            tileFormat: TILE_FORMAT_ZFP,
            datasetId: this.cubeId,
            parameter: this.parameter,
            lod: this.lod,
            xyzs: xyzs,
        }
        if (this.indexMaskEventType) {
            r["indexMaskEventType"] = this.indexMaskEventType;
        }
        return r;
    }

    cubeId: string;
    parameter: string;
    lod: number;
    x: number;
    y: number;
    z: number;
    indexMaskEventType: string | null;
}


export class Tile3DClipBoundary {
    // for fully visible range, first component = 0, second component = 1
    // first component clips from left/min, second component clips from right/max
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;

    constructor(xMinClipBoundary: number, xMaxClipBoundary: number, yMinClipBoundary: number, yMaxClipBoundary: number, zMinClipBoundary: number, zMaxClipBoundary: number) {
        this.xMin = xMinClipBoundary;
        this.xMax = xMaxClipBoundary;
        this.yMin = yMinClipBoundary;
        this.yMax = yMaxClipBoundary;
        this.zMin = zMinClipBoundary;
        this.zMax = zMaxClipBoundary;
    }

    toStringDecimal() {
        return `X: [${this.xMin.toFixed(4)}, ${this.xMax.toFixed(4)}], Y: [${this.yMin.toFixed(4)}, ${this.yMax.toFixed(4)}], Z: [${this.zMin.toFixed(4)}, ${this.zMax.toFixed(4)}]`;
    }
}
