import { Vector2, Vector3, DataTexture, NearestFilter, LinearMipMapLinearFilter } from 'three';
import {
    CubeFace, FLOAT_NAN_REPLACEMENT_VALUE,
    DataType, TILES_TEXTURE_NAME, NAN_FACTOR_MASK_NAN_VALUE, HALF_FLOAT_NAN_REPLACEMENT_VALUE
} from '../../../constants';
import { CubeClientContext } from '../../../client';
import { TileTextureView2DUpdateResult, TileTextureView3DUpdateResult } from '../../../rendering/tile-texture-views';
import { Tile2D, Tile3D } from '../../../core/tiles';
import { DataValue, StorageUsage } from './types';
import { TileStorageAllocator } from './allocator';
import { TileDataPatcher } from './data-patcher';
import { TileDownloadTracker } from '../download-tracker';
import { TileStorageMutator } from './mutator';
import { TileDataAccessor } from './data-accessor';

export { DataValue, StorageUsage } from './types';

export class TileStorage {
    // Storage arrays (public so helper modules can mutate them in-place)
    tile2dStoragesFloat!: Float32Array[][];
    tile3dStoragesFloat!: (Float32Array | Uint16Array)[];
    tile3dQuantileIndexStorages!: Uint8Array[];
    tileStoragesRgb!: Uint8Array[][];

    dataType = DataType.Float;

    // Allocation tracking (mutated by allocator)
    tile2dStoragesAllocated!: Set<string>;
    storages3dAllocated!: Set<string>;
    totalBytesAllocatedFor2d: number = 0;
    totalBytesAllocatedFor3d: number = 0;

    // Counters / shared state (read & written across helpers and external callers)
    tile2dDecodesFailed: number = 0;
    tile3dDecodesFailed: number = 0;
    maxCompressionErrors = new Map<string, number>();

    // Configuration (read by helpers)
    textureFilteringEnabled: boolean;
    useHalfFloatsForTile3d: boolean;

    private context: CubeClientContext;
    private allocator: TileStorageAllocator;
    private patcher: TileDataPatcher;
    private tracker: TileDownloadTracker;
    private mutator: TileStorageMutator;
    private accessor: TileDataAccessor;

    constructor(context: CubeClientContext) {
        this.context = context;
        this.textureFilteringEnabled = context.textureFilteringEnabled;
        this.useHalfFloatsForTile3d = context.useHalfFloatsForTile3d;

        this.allocator = new TileStorageAllocator(context, this);
        this.patcher = new TileDataPatcher(context, this);
        this.tracker = new TileDownloadTracker(context);
        this.mutator = new TileStorageMutator(context, this);
        this.accessor = new TileDataAccessor(context, this);
    }

    resetTextureFiltering() {
        this.toggleLinearTextureFiltering(this.context.textureFilteringEnabled);
    }

    setDataType(valueType: DataType) {
        this.dataType = valueType;
        this.context.log("Set data value type to", DataType[valueType]);
    }

    toggleLinearTextureFiltering(enabled: boolean = false) {
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

    // --- Allocator delegations ---

    allocateTile2dStorages(forceStorageRecreation: boolean = false) {
        this.allocator.allocateTile2dStorages(forceStorageRecreation);
    }

    allocateTile3dStorages(forceStorageRecreation: boolean = false) {
        this.allocator.allocateTile3dStorages(forceStorageRecreation);
    }

    allocateTexture2d(face: CubeFace, lod: number) {
        this.allocator.allocateTexture2d(face, lod);
    }

    allocateTexture3d(lod: number) {
        this.allocator.allocateTexture3d(lod);
    }

    isTexture3dAllocated(lod: number): boolean {
        return this.allocator.isTexture3dAllocated(lod);
    }

    get3dStorageType(): string {
        return this.allocator.get3dStorageType();
    }

    getActual3dStorageSizeOfLodInBytes(): StorageUsage {
        return this.allocator.getActual3dStorageSizeOfLodInBytes();
    }

    getTheoretical3dStorageSizeOfLodInBytes(lod: number): StorageUsage {
        return this.allocator.getTheoretical3dStorageSizeOfLodInBytes(lod);
    }

    // --- Patcher delegations ---

    putNaNTile2dInStorage(tile: Tile2D) {
        this.patcher.putNaNTile2dInStorage(tile);
    }

    putNaNTile3dInStorage(tile: Tile3D) {
        this.patcher.putNaNTile3dInStorage(tile);
    }

    putTile2dInStorage(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, replaceRealNans: boolean = false, storageTargetOverride: Float32Array | undefined = undefined, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        this.patcher.putTile2dInStorage(tile, data, nanMask, replaceRealNans, storageTargetOverride, expectedDtype);
    }

    putTile3dInStorage(tile: Tile3D, data: ArrayBuffer, quantileIndexAndNanFactorMasks: ArrayBuffer, replaceRealNans: boolean = false, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        this.patcher.putTile3dInStorage(tile, data, quantileIndexAndNanFactorMasks, replaceRealNans, expectedDtype);
    }

    putResampledTile2dInStorage(tile: Tile2D, data: ArrayBuffer, nanMask: ArrayBuffer | undefined, resampleResolution: number, replaceRealNans: boolean = false, storageTargetOverride?: Float32Array | Uint8Array, expectedDtype: typeof Uint8Array | typeof Float32Array | typeof Float64Array | undefined = undefined) {
        this.patcher.putResampledTile2dInStorage(tile, data, nanMask, resampleResolution, replaceRealNans, storageTargetOverride, expectedDtype);
    }

    putQuantileIndexMaskInStorage(tile: Tile3D, quantileIndexMask: ArrayBuffer) {
        this.patcher.putQuantileIndexMaskInStorage(tile, quantileIndexMask);
    }

    // --- Download-tracker delegations ---

    totalTiles2dDownloadsTriggered(): number {
        return this.tracker.totalTiles2dDownloadsTriggered();
    }

    totalTiles2dDownloadsFinished(): number {
        return this.tracker.totalTiles2dDownloadsFinished();
    }

    totalTiles3dDownloadsTriggered(): number {
        return this.tracker.totalTiles3dDownloadsTriggered();
    }

    totalTiles3dDownloadsFinished(): number {
        return this.tracker.totalTiles3dDownloadsFinished();
    }

    isTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        return this.tracker.isTileDownloadFinished(tile);
    }

    isTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        return this.tracker.isTileDownloadTriggered(tile);
    }

    setTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        this.tracker.setTileDownloadTriggered(tile);
    }

    setTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        this.tracker.setTileDownloadFinished(tile);
    }

    areTiles2dDownloadsCompleteForFace(face: CubeFace): boolean {
        return this.tracker.areTiles2dDownloadsCompleteForFace(face);
    }

    areTiles3dDownloadsComplete(): boolean {
        return this.tracker.areTiles3dDownloadsComplete();
    }

    resetTileMaps() {
        this.tile2dDecodesFailed = 0;
        this.maxCompressionErrors.clear();
        this.tracker.resetAll();
    }

    resetTile2dDownloadMapsForFace(face: CubeFace) {
        this.tracker.resetTile2dForFace(face);
    }

    resetTile3dDownloadMapsForLod(lod: number) {
        if (this.tile3dStoragesFloat && this.tile3dStoragesFloat.length > lod) {
            this.tile3dStoragesFloat[lod].fill(this.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE);
            this.tile3dQuantileIndexStorages[lod].fill(NAN_FACTOR_MASK_NAN_VALUE);
        }

        const reset = this.tracker.resetTile3dForLod(lod);
        this.context.log(`Reset ${reset} 3d tile download maps for LoD ${lod} and filled storage with not-loaded values`);
    }

    resetTileDownloadMapsAfterTileTextureView2dUpdate(face: CubeFace, lod: number, previousOffset: Vector2) {
        this.tracker.pruneTile2dAfterTtvUpdate(face, lod, previousOffset);
    }

    resetTileDownloadMapsAfterTileTextureView3dUpdate(lod: number, previousOffset: Vector3) {
        this.tracker.pruneTile3dAfterTtvUpdate(lod, previousOffset);
    }

    // --- Accessor delegations ---

    getTile2dDataValue(face: CubeFace, lod: number, tileX: number, tileY: number, pixelX: number, pixelY: number): DataValue {
        return this.accessor.getTile2dDataValue(face, lod, tileX, tileY, pixelX, pixelY);
    }

    getTile3dDataValue(lod: number, tileX: number, tileY: number, tileZ: number, pixelX: number, pixelY: number, pixelZ: number): DataValue {
        return this.accessor.getTile3dDataValue(lod, tileX, tileY, tileZ, pixelX, pixelY, pixelZ);
    }

    updateTextureForTile2d(tile: Tile2D) {
        this.accessor.updateTextureForTile2d(tile);
    }

    updateTextureForTile3d(tile: Tile3D) {
        this.accessor.updateTextureForTile3d(tile);
    }

    // --- Mutator delegations ---

    moveTileStorageDataAfterTileTextureView2dUpdate(face: CubeFace, lod: number, updateResult: TileTextureView2DUpdateResult) {
        this.mutator.moveTileStorageDataAfterTileTextureView2dUpdate(face, lod, updateResult);
    }

    moveTileStorageDataAfterTileTextureView3dUpdate(lod: number, updateResult: TileTextureView3DUpdateResult) {
        this.mutator.moveTileStorageDataAfterTileTextureView3dUpdate(lod, updateResult);
    }
}
