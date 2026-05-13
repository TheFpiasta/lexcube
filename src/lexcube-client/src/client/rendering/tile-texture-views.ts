import { Box3, Vector2, Vector3 } from 'three';
import { IUniform } from 'three';
import { clamp } from 'three/src/math/MathUtils';
import { CubeFace, Dimension, TILE_SIZE_2D, TILE_SIZE_3D } from '../constants';
import { CubeSelection } from '../interaction';
import { Tile2D, Tile3D } from '../tiledata';


class MultiBlockRenderPass {
    private coords: number[];
    tiles: Tile3D[];
    private actualSizeInTiles: Vector3;
    tileTextureView: TileTextureView3D;
    private downloadStatuses: boolean[];

    private static readonly keySeparator: string = "_";

    constructor(coords: number[], tiles: Tile3D[], actualSizeInTiles: Vector3, globalWorldSize: Vector3) {
        this.coords = coords;
        this.tiles = tiles;
        this.downloadStatuses = new Array<boolean>(tiles.length).fill(false);
        this.actualSizeInTiles = actualSizeInTiles.clone();
        this.tileTextureView = this.createTileTextureView(globalWorldSize);
        console.log(`Created MultiBlockRenderPass at coords ${this.coords.join(", ")} with ${this.tiles.length} tiles and actual size in tiles ${this.actualSizeInTiles.x}, ${this.actualSizeInTiles.y}, ${this.actualSizeInTiles.z}. TTV is size ${this.tileTextureView.getSizeInTiles().x}, ${this.tileTextureView.getSizeInTiles().y}, ${this.tileTextureView.getSizeInTiles().z}, offset ${this.tileTextureView.getOffsetInTiles().x}, ${this.tileTextureView.getOffsetInTiles().y}, ${this.tileTextureView.getOffsetInTiles().z}`);
    }

    getKey() {
        return this.coords.join("_");
    }

    private createTileTextureView(globalWorldSize: Vector3): TileTextureView3D {
        return TileTextureView3D.createWithSizeAndOffset(
            this.tiles[0].lod,
            new Vector3(this.coords[0], this.coords[1], this.coords[2]),
            this.actualSizeInTiles.clone(),
            globalWorldSize.clone()
        );
    }

    setTileFinishedDownloading(tile: Tile3D) {
        const tileIndex = this.tiles.findIndex(t => t.x == tile.x && t.y == tile.y && t.z == tile.z && t.lod == tile.lod);
        if (tileIndex < 0) {
            throw new Error("Tile not part of this render pass");
        }
        this.downloadStatuses[tileIndex] = true;
        return this.downloadStatuses.every(status => status);
    }

    static from(lod: number, visibleTiles: Tile3D[], tilesPerPassShape: Vector3, lightPositionData: Vector3): MultiBlockRenderPass[] {
        // wip: later smarter,
        // const lowestTileCoordinate = new Vector3(visibleTiles[0].x, visibleTiles[0].y, visibleTiles[0].z);

        const tilesToPartitionsMap = visibleTiles.map(tile => [
            Math.floor(tile.x / tilesPerPassShape.x),
            Math.floor(tile.y / tilesPerPassShape.y),
            Math.floor(tile.z / tilesPerPassShape.z)].join(this.keySeparator)
        );

        const uniquePartitions = Array.from(new Set(tilesToPartitionsMap)).map(key => { return { key: key, coords: key.split(this.keySeparator).map(s => parseInt(s)) }; });

        const lightPositionInTiles = lightPositionData.clone().divideScalar(TILE_SIZE_3D * Math.pow(2, lod));

        // sort partitions by distance from light rendering
        uniquePartitions.sort((a, b) => {
            const aPosition = new Vector3(a.coords[0], a.coords[1], a.coords[2]);
            const aBox = new Box3(aPosition, aPosition.clone().add(tilesPerPassShape).subScalar(0.01));
            const bPosition = new Vector3(b.coords[0], b.coords[1], b.coords[2]);
            const bBox = new Box3(bPosition, bPosition.clone().add(tilesPerPassShape).subScalar(0.01));

            // ascending order, lowest distance to light first
            return aBox.distanceToPoint(lightPositionInTiles) - bBox.distanceToPoint(lightPositionInTiles);
        });

        const renderPasses: MultiBlockRenderPass[] = [];

        for (let p = 0; p < uniquePartitions.length; p++) {
            const partitionKey = uniquePartitions[p].key;
            const applicableTiles = visibleTiles.filter((tile, tileIndex) => tilesToPartitionsMap[tileIndex] === partitionKey);
            const actualSize = applicableTiles.reduce((size, tile) => {
                size.x = Math.max(size.x, tile.x % tilesPerPassShape.x + 1);
                size.y = Math.max(size.y, tile.y % tilesPerPassShape.y + 1);
                size.z = Math.max(size.z, tile.z % tilesPerPassShape.z + 1);
                return size;
            }, new Vector3(0,0,0));
            renderPasses.push(new MultiBlockRenderPass(uniquePartitions[p].coords, applicableTiles, actualSize, tilesPerPassShape.clone()));
        }

        return renderPasses;
    }
}


class TileTextureView2DUpdateResult {
    previousOffset!: Vector2;
    offset!: Vector2;
    size!: Vector2;
    changed!: boolean;
    firstOffsetUpdate!: boolean;
}

class TileTextureView3DUpdateResult {
    previousOffset!: Vector3;
    offset!: Vector3;
    size!: Vector3;
    changed!: boolean;
    firstOffsetUpdate!: boolean;
}

class TileTextureView2D {
    private face: CubeFace;
    private lod: number;
    private maxTextureSize: number;

    private overflowingInX: boolean = false;
    private overflownX: number = 0;

    private sizeSet: boolean = false;
    private firstOffsetUpdate: boolean = true;
    private tilesOnFace: Vector2;

    private sizeInTiles: Vector2;
    private offsetInTiles: Vector2;

    private tileOffsetsUniform: IUniform;
    private tileSizesUniform: IUniform;

    constructor(face: CubeFace, lod: number, maxTextureSize: number, tilesOnFace: Vector2, tileOffsetsUniform: IUniform, tileSizesUniform: IUniform) {
        this.face = face;
        this.lod = lod;
        this.maxTextureSize = maxTextureSize;
        this.offsetInTiles = new Vector2();
        this.sizeInTiles = new Vector2(1, 1);
        this.tilesOnFace = tilesOnFace;
        this.tileOffsetsUniform = tileOffsetsUniform;
        this.tileSizesUniform = tileSizesUniform;
    }

    getSizeInTiles() {
        return this.sizeInTiles;
    }

    getOffsetInTiles() {
        return this.offsetInTiles;
    }

    needsInitialUpdate() {
        return this.firstOffsetUpdate;
    }

    updateSize() {
        const requestedSize = this.tilesOnFace.clone().multiplyScalar(TILE_SIZE_2D);
        const setSize = requestedSize.min(new Vector2(this.maxTextureSize, this.maxTextureSize));
        const targetTiles = setSize.divideScalar(TILE_SIZE_2D).ceil();
        this.sizeInTiles.copy(targetTiles.min(this.tilesOnFace));

        (this.tileSizesUniform.value[this.lod] as Vector2).copy(this.sizeInTiles.clone().multiplyScalar(TILE_SIZE_2D * Math.pow(2, this.lod)));
    }

    updateOffset(cubeSelection: CubeSelection, dimensionOverflow: boolean[]): TileTextureView2DUpdateResult {
        let thisIsFirstOffsetUpdate = false;
        if (this.firstOffsetUpdate) {
            this.firstOffsetUpdate = false;
            thisIsFirstOffsetUpdate = true;
        }
        if (!this.sizeSet) {
            this.updateSize();
            this.sizeSet = true;
        }
        const previousOffset = this.offsetInTiles.clone();

        const displaySize = cubeSelection.getDisplaySizeVector2d(this.face);
        const displayOffset = cubeSelection.getDisplayOffsetVector2d(this.face);

        const focusPointPixels = displaySize.clone().multiplyScalar(0.5).add(displayOffset);
        const focusPointTile = focusPointPixels.clone().divideScalar(TILE_SIZE_2D * Math.pow(2, this.lod));

        const xIsOverflowing = dimensionOverflow[this.face < 4 ? 0 : 1];

        if (!this.isComplete()) {
            // Assumes that the size.x * 0.5 can be covered by the available texture size.
            const target = focusPointTile.clone().sub(this.sizeInTiles.clone().multiplyScalar(0.5));
            const maxX = xIsOverflowing ? this.tilesOnFace.x - 1 : this.tilesOnFace.x - this.sizeInTiles.x;
            this.offsetInTiles.x = clamp((Math.round(target.x) + this.tilesOnFace.x) % this.tilesOnFace.x, 0, maxX);
            this.offsetInTiles.y = clamp((Math.round(target.y) + this.tilesOnFace.y) % this.tilesOnFace.y, 0, this.tilesOnFace.y - this.sizeInTiles.y);
        } else {
            this.offsetInTiles.set(0, 0); // easier handling of the "ttv is complete" case
        }

        this.overflowingInX = ((this.offsetInTiles.x + this.sizeInTiles.x) > this.tilesOnFace.x);
        this.overflownX = Math.max(0, (this.offsetInTiles.x + this.sizeInTiles.x) - this.tilesOnFace.x);

        const changed = !previousOffset.equals(this.offsetInTiles);
        if (this.face == 0 && this.lod == 0) {
            console.log(`update TileTextureView ${CubeFace[this.face]}, Lod: ${this.lod}. [Complete: ${this.isComplete()}]. FinalSize: ${this.sizeInTiles.x}, ${this.sizeInTiles.y}. Offset: ${this.offsetInTiles.x}, ${this.offsetInTiles.y}. Changed: ${changed}`)
        }

        return { previousOffset, offset: this.offsetInTiles, size: this.sizeInTiles, changed, firstOffsetUpdate: thisIsFirstOffsetUpdate }
    }

    applyOffsetToShader() {
        (this.tileOffsetsUniform.value[this.lod] as Vector2).copy(this.offsetInTiles.clone().multiplyScalar(TILE_SIZE_2D * Math.pow(2, this.lod)));
    }

    getTilePositionInView(tile: Tile2D, offsetOverride?: Vector2) {
        const tilePositionInView = new Vector2(tile.x, tile.y).sub(offsetOverride ?? this.offsetInTiles);
        if (this.overflowingInX && tile.x < this.overflownX) {
            tilePositionInView.x += this.tilesOnFace.x;
        }
        return tilePositionInView;
    }

    containsTile(tile: Tile2D, offsetOverride?: Vector2) {
        const tilePositionInView = this.getTilePositionInView(tile, offsetOverride);
        return (tilePositionInView.x >= 0 && tilePositionInView.x < this.sizeInTiles.x && tilePositionInView.y >= 0 && tilePositionInView.y < this.sizeInTiles.y);
    }

    isComplete() {
        return this.tilesOnFace.equals(this.sizeInTiles);
    }
}

class TileTextureView3D {

    private overflowingInX: boolean = false;
    private overflownX: number = 0;

    private sizeSet: boolean = false;
    private firstOffsetUpdate: boolean = true;

    private tilesTotal: Vector3 = new Vector3(-1, -1, -1);

    private lod!: number;
    private offsetInTiles: Vector3 = new Vector3(-1, -1, -1);
    private sizeInTiles: Vector3 = new Vector3(-1, -1, -1);

    // private readonly MAXIMUM_SIZE_IN_TILES = 2; // maximum 3x3x3 = 768x768x768px per LOD = 2.11 GB in memory
    private readonly maxTextureSize = 512;

    private tileOffsetsUniform?: IUniform;
    private tileSizesUniform?: IUniform;

    private globalWorldSize!: Vector3;

    constructor() {
    }

    static createWithSizeAndOffset(lod: number, offsetInTiles: Vector3, sizeInTiles: Vector3, globalWorldSize: Vector3) {
        const ttv = new TileTextureView3D();
        ttv.lod = lod;
        ttv.globalWorldSize = globalWorldSize;
        ttv.offsetInTiles = offsetInTiles;
        ttv.sizeInTiles = sizeInTiles;
        return ttv;
    }

    static createWithDynamicSize(lod: number, totalTiles: Vector3, globalWorldSize: Vector3, uniformLocations: { offsets: IUniform, sizes: IUniform}) {
        const ttv = new TileTextureView3D();
        ttv.lod = lod;
        ttv.globalWorldSize = globalWorldSize;
        ttv.tileOffsetsUniform = uniformLocations.offsets;
        ttv.tileSizesUniform = uniformLocations.sizes;
        ttv.tilesTotal = totalTiles;
        return ttv;
    }

    updateSize() {
        const requestedSize = this.tilesTotal.clone().multiplyScalar(TILE_SIZE_3D);
        const setSize = requestedSize.min(new Vector3(this.maxTextureSize, this.maxTextureSize, this.maxTextureSize));
        const targetTiles = setSize.divideScalar(TILE_SIZE_3D).ceil();
        this.sizeInTiles.copy(targetTiles.min(this.tilesTotal));

        if (!this.tileSizesUniform) {
            console.warn("TileTextureView3D: uniform locations not set, cannot update size");
            return;
        }

        (this.tileSizesUniform.value[this.lod] as Vector3).copy(this.getSizeInWorld());
    }

    getTilePositionInView(tile: Tile3D, offsetOverride?: Vector3) {
        const tilePositionInView = new Vector3(tile.x, tile.y, tile.z).sub(offsetOverride ?? this.offsetInTiles);
        if (this.overflowingInX && tile.x < this.overflownX) {
            tilePositionInView.x += this.tilesTotal.x;
        }
        return tilePositionInView;
    }

    containsTile(tile: Tile3D, offsetOverride?: Vector3) {
        const tilePositionInView = this.getTilePositionInView(tile, offsetOverride);
        return (tilePositionInView.x >= 0 && tilePositionInView.x < this.sizeInTiles.x && tilePositionInView.y >= 0 && tilePositionInView.y < this.sizeInTiles.y && tilePositionInView.z >= 0 && tilePositionInView.z < this.sizeInTiles.z);
    }

    private getSizeInWorld() {
        return this.sizeInTiles.clone().multiplyScalar(TILE_SIZE_3D * Math.pow(2, this.lod));
    }

    private getOffsetInWorld() {
        return this.offsetInTiles.clone().multiplyScalar(TILE_SIZE_3D * Math.pow(2, this.lod));
    }

    getSizeInTiles() {
        return this.sizeInTiles.clone();
    }

    getOffsetInTiles() {
        return this.offsetInTiles.clone();
    }

    updateUniforms(uniformLocations: { offsets: IUniform, sizes: IUniform}) {
        uniformLocations.offsets.value[this.lod].copy(this.getOffsetInWorld());
        uniformLocations.sizes.value[this.lod].copy(this.getSizeInWorld());
    }

    possibleToRender(displaySize: Vector3) {
        this.initializeSizeIfNeeded();

        // calculate with buffer to allow for pan interactions without reload
        const ceiledRequiredTextures = displaySize.clone().divideScalar(TILE_SIZE_3D * Math.pow(2, this.lod)).ceil().addScalar(1);

        const requiredWorldSpace = ceiledRequiredTextures.clone().multiplyScalar(TILE_SIZE_3D * Math.pow(2, this.lod)).min(this.globalWorldSize);

        const sizeInWorld = this.getSizeInWorld();
        if (requiredWorldSpace.x <= sizeInWorld.x &&
            requiredWorldSpace.y <= sizeInWorld.y &&
            requiredWorldSpace.z <= sizeInWorld.z) {
            return true;
        }
        return false;
    }

    needsInitialUpdate() {
        return this.firstOffsetUpdate;
    }

    isComplete() {
        return this.tilesTotal.equals(this.sizeInTiles);
    }

    private initializeSizeIfNeeded() {
        if (!this.sizeSet) {
            this.updateSize();
            this.sizeSet = true;
        }
    }

    updateOffset(cubeSelection: CubeSelection, dimensionOverflow: boolean[]): TileTextureView3DUpdateResult {
        let thisIsFirstOffsetUpdate = false;
        if (this.firstOffsetUpdate) {
            this.firstOffsetUpdate = false;
            thisIsFirstOffsetUpdate = true;
        }
        this.initializeSizeIfNeeded();

        const previousOffset = this.offsetInTiles.clone();

        const displaySize = cubeSelection.getDisplaySizeVector3d();
        const displayOffset = cubeSelection.getDisplayOffsetVector3d();

        const focusPointPixels = displaySize.clone().multiplyScalar(0.5).add(displayOffset);
        const focusPointTile = focusPointPixels.clone().divideScalar(TILE_SIZE_3D * Math.pow(2, this.lod));

        const xIsOverflowing = dimensionOverflow[Dimension.X];

        if (!this.isComplete()) {
            // Assumes that the size.x * 0.5 can be covered by the available texture size.
            const target = focusPointTile.clone().sub(this.sizeInTiles.clone().multiplyScalar(0.5)).max(new Vector3(0, 0, 0));
            const maxX = xIsOverflowing ? this.tilesTotal.x - 1 : this.tilesTotal.x - this.sizeInTiles.x;
            this.offsetInTiles.x = clamp((Math.round(target.x) + this.tilesTotal.x) % this.tilesTotal.x, 0, maxX);
            console.log(`DisplaySizeX: ${displaySize.x}, DisplayOffsetX: ${displayOffset.x} focusPointPixelsX: ${focusPointPixels.x}, focusPointTileX: ${focusPointTile.x}`);
            console.log(`X target: ${target.x}, offset: ${this.offsetInTiles.x}, size: ${this.sizeInTiles.x}, total: ${this.tilesTotal.x}, maxX: ${maxX}`);
            this.offsetInTiles.y = clamp((Math.round(target.y) + this.tilesTotal.y) % this.tilesTotal.y, 0, this.tilesTotal.y - this.sizeInTiles.y);
            this.offsetInTiles.z = clamp((Math.round(target.z) + this.tilesTotal.z) % this.tilesTotal.z, 0, this.tilesTotal.z - this.sizeInTiles.z);
        } else {
            this.offsetInTiles.set(0, 0, 0); // easier handling of the "ttv is complete" case
        }

        this.overflowingInX = ((this.offsetInTiles.x + this.sizeInTiles.x) > this.tilesTotal.x);
        this.overflownX = Math.max(0, (this.offsetInTiles.x + this.sizeInTiles.x) - this.tilesTotal.x);

        const changed = !previousOffset.equals(this.offsetInTiles);
        console.log(`update TileTextureView3D Lod: ${this.lod}. [Complete: ${this.isComplete()}]. FinalSize: ${this.sizeInTiles.x}, ${this.sizeInTiles.y}, ${this.sizeInTiles.z}. Offset: ${this.offsetInTiles.x}, ${this.offsetInTiles.y}, ${this.offsetInTiles.z}. Changed: ${changed}, OverflowX: ${this.overflowingInX}`)

        return { previousOffset, offset: this.offsetInTiles, size: this.sizeInTiles, changed, firstOffsetUpdate: thisIsFirstOffsetUpdate }
    }

    applyOffsetToShader() {
        if (!this.tileOffsetsUniform) {
            console.warn("TileTextureView3D: uniform locations not set, cannot apply offset to shader");
            return;
        }
        (this.tileOffsetsUniform.value[this.lod] as Vector3).copy(this.getOffsetInWorld());
    }

}

export { MultiBlockRenderPass, TileTextureView2D, TileTextureView3D, TileTextureView2DUpdateResult, TileTextureView3DUpdateResult }
