import { Vector2, Vector3 } from 'three';
import { CubeFace, TILE_SIZE_2D, TILE_SIZE_3D } from '../../../constants';
import { CubeClientContext } from '../../../client';
import { TileTextureView2DUpdateResult, TileTextureView3DUpdateResult } from '../../../rendering/tile-texture-views';
import type { TileStorage } from '.';

export class TileStorageMutator {
    private context: CubeClientContext;
    private host: TileStorage;

    constructor(context: CubeClientContext, host: TileStorage) {
        this.context = context;
        this.host = host;
    }

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

        const copyOperations: Vector3[][] = [];
        const resetOperations: Vector3[] = [];
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

        for (const c of copyOperations) {
            this.copyDataBetweenTiles3d(lod, c[0], c[1]);
        }
        this.context.log("Finished moving storage data:", copyOperations.length, "tiles copied,", resetOperations.length, "tiles reset");
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

        const copyOperations: Vector2[][] = [];
        const resetOperations: Vector2[] = [];
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

        for (const c of copyOperations) {
            this.copyDataBetweenTiles2d(face, lod, c[0], c[1]);
        }
        this.context.log("Finished moving storage data:", copyOperations.length, "tiles copied,", resetOperations.length, "tiles reset");
    }

    private copyDataBetweenTiles2d(face: CubeFace, lod: number, sourceTileTtvLocalCoords: Vector2, targetTileTtvLocalCoords: Vector2) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(face, lod);

        console.log(`Copying tile data FROM (${sourceTileTtvLocalCoords.x}, ${sourceTileTtvLocalCoords.y}) TO (${targetTileTtvLocalCoords.x}, ${targetTileTtvLocalCoords.y}) for face ${CubeFace[face]}, LoD ${lod}`);

        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const sourceStartIndex = (sourceTileTtvLocalCoords.x) * TILE_SIZE_2D + (sourceTileTtvLocalCoords.y) * indexIncrementPerRow * TILE_SIZE_2D;
        const targetStartIndex = (targetTileTtvLocalCoords.x) * TILE_SIZE_2D + (targetTileTtvLocalCoords.y) * indexIncrementPerRow * TILE_SIZE_2D;

        for (let y = 0; y < TILE_SIZE_2D; y++) {
            const sourceRowStart = sourceStartIndex + y * indexIncrementPerRow;
            const targetRowStart = targetStartIndex + y * indexIncrementPerRow;
            this.host.tile2dStoragesFloat[face][lod].copyWithin(targetRowStart, sourceRowStart, sourceRowStart + TILE_SIZE_2D);
        }
    }

    private copyDataBetweenTiles3d(lod: number, sourceTileTtvLocalCoords: Vector3, targetTileTtvLocalCoords: Vector3) {
        const ttvSizeInTiles = this.context.rendering.getTileTextureView3dSize(lod);

        console.log(`Copying 3d tile data FROM (${sourceTileTtvLocalCoords.x}, ${sourceTileTtvLocalCoords.y}, ${sourceTileTtvLocalCoords.z}) TO (${targetTileTtvLocalCoords.x}, ${targetTileTtvLocalCoords.y}, ${targetTileTtvLocalCoords.z}) for LoD ${lod}`);

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
                this.host.tile3dStoragesFloat[lod].copyWithin(targetRowStart, sourceRowStart, sourceRowStart + TILE_SIZE_3D);
                this.host.tile3dQuantileIndexStorages[lod].copyWithin(targetRowStart * 2, sourceRowStart * 2, (sourceRowStart + TILE_SIZE_3D) * 2);
            }
        }
    }
}
