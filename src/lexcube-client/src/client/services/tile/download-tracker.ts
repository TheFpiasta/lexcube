import { Vector2, Vector3 } from 'three';
import { CubeFace } from '../../constants';
import { CubeClientContext } from '../../client';
import { Tile2D, Tile3D } from '../../core/tiles';

export class TileDownloadTracker {
    private context: CubeClientContext;

    private tiles2dDownloadFinished = new Array<Map<string, boolean>>();
    private tiles2dDownloadTriggered = new Array<Map<string, boolean>>();
    private tiles3dDownloadFinished = new Map<string, boolean>();
    private tiles3dDownloadTriggered = new Map<string, boolean>();

    constructor(context: CubeClientContext) {
        this.context = context;
    }

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

    resetAll() {
        this.tiles2dDownloadTriggered.splice(0, this.tiles2dDownloadTriggered.length);
        this.tiles2dDownloadFinished.splice(0, this.tiles2dDownloadFinished.length);
        for (let i = 0; i < 6; i++) {
            this.tiles2dDownloadTriggered.push(new Map<string, boolean>());
            this.tiles2dDownloadFinished.push(new Map<string, boolean>());
        }
        this.tiles3dDownloadTriggered.clear();
        this.tiles3dDownloadFinished.clear();
    }

    resetTile2dForFace(face: CubeFace) {
        this.tiles2dDownloadTriggered[face].clear();
        this.tiles2dDownloadFinished[face].clear();
    }

    resetTile3dForLod(lod: number): number {
        const keys = Array.from(this.tiles3dDownloadTriggered.keys());
        let reset = 0;
        for (const key of keys) {
            const l = parseInt(key.split("_")[0]);
            if (l == lod) {
                reset++;
                this.tiles3dDownloadTriggered.delete(key);
                this.tiles3dDownloadFinished.delete(key);
            }
        }
        this.tiles3dDownloadTriggered.clear();
        this.tiles3dDownloadFinished.clear();
        return reset;
    }

    pruneTile2dAfterTtvUpdate(face: CubeFace, lod: number, previousOffset: Vector2) {
        for (const m of [this.tiles2dDownloadTriggered[face], this.tiles2dDownloadFinished[face]]) {
            m.forEach((_v, k) => {
                const t = Tile2D.fromHashKey(this.context, k);
                if (t.lod == lod) {
                    if (!this.context.rendering.tileContainedInTileTextureView2d(t, previousOffset)) {
                        m.delete(k);
                    }
                }
            });
        }
    }

    pruneTile3dAfterTtvUpdate(lod: number, previousOffset: Vector3) {
        for (const m of [this.tiles3dDownloadTriggered, this.tiles3dDownloadFinished]) {
            m.forEach((_v, k) => {
                const t = Tile3D.fromHashKey(this.context, k);
                if (t.lod == lod) {
                    if (!this.context.rendering.tileContainedInTileTextureView3d(t, previousOffset)) {
                        m.delete(k);
                    }
                }
            });
        }
    }
}
