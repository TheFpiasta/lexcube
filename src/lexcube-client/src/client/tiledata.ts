import { Vector2, Vector3 } from 'three'

import { CubeFace, Dimension, TILE_SIZE_2D, DataType, TileRequestIntention } from './constants';
import { CubeClientContext } from './client';

import { TileTextureView2DUpdateResult, TileTextureView3DUpdateResult } from './rendering/tile-texture-views';
import { Tile2D, Tile3D, Tile3DClipBoundary } from './core/tiles';
import { Colormap } from './core/colormap';
import { DecompressedTileResult, TileDecompressor } from './services/tile/decompression';
import { StorageUsage, TileStorage } from './services/tile/storage';
import { ParameterRange } from './interaction';

// Tile2D, Tile3D, Tile3DClipBoundary moved to core/tiles.ts
// ColormapEntry, Colormap moved to core/colormap.ts

class TileData {
    // from https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance Welford's online algorithm
    private observedValuesCount = 0;
    private observedValuesMean = 0;
    private observedValuesVariance = 0;
    statisticalColormapLowerBound = 0;
    statisticalColormapUpperBound = 0;

    get observedMeanValue() {
        return this.observedValuesMean;
    }

    observedMinValue = Infinity;
    observedMaxValue = -Infinity;

    private lastObservedMinValue = 0;
    private lastObservedMaxValue = 0;

    private colormap: Colormap = new Colormap();
    colormapFlipped = false;
    colormapUseStandardDeviation = true;
    colormapMinValueOverride: number | null = null;
    colormapMaxValueOverride: number | null = null;
    symmetricalColormapAroundZero = false;

    private context: CubeClientContext;
    private colormapMinValue: number = 0;
    private colormapMaxValue: number = 0;

    ignoreStatisticalColormapBounds: boolean = false;

    private tileToTimeSeriesMap: Map<string, number[]> = new Map();

    // Delegated services
    private decompressor: TileDecompressor;
    private storage: TileStorage;

    constructor(context: CubeClientContext) {
        this.context = context;
        this.decompressor = new TileDecompressor();
        this.storage = new TileStorage(context);
    }

    // --- Facade: storage properties ---

    get tile2dDecodesFailed(): number { return this.storage.tile2dDecodesFailed; }
    set tile2dDecodesFailed(v: number) { this.storage.tile2dDecodesFailed = v; }

    get tile3dDecodesFailed(): number { return this.storage.tile3dDecodesFailed; }
    set tile3dDecodesFailed(v: number) { this.storage.tile3dDecodesFailed = v; }

    get maxCompressionErrors(): Map<string, number> { return this.storage.maxCompressionErrors; }

    get totalBytesAllocatedFor3d(): number { return this.storage.totalBytesAllocatedFor3d; }

    isTexture3dAllocated(lod: number): boolean {
        return this.storage.isTexture3dAllocated(lod);
    }

    getColormapMaxValue(): number {
        return this.colormapMaxValue;
    }

    getColormapMinValue(): number {
        return this.colormapMinValue;
    }

    // --- Statistics ---

    private updateStatisticalMeasures(tileMin: number, tileMax: number, tileMean: number, tileVariance: number) {
        if (isNaN(tileMin)) {
            return;
        }
        if (this.observedMinValue > tileMin) {
            this.observedMinValue = tileMin;
            this.context.interaction.updateDisplaySignificance();
        }
        if (this.observedMaxValue < tileMax) {
            this.observedMaxValue = tileMax;
            this.context.interaction.updateDisplaySignificance();
        }
        this.observedValuesCount += 1;
        const meanDelta = tileMean - this.observedValuesMean;
        this.observedValuesMean += meanDelta / this.observedValuesCount;
        const varianceDelta = tileVariance - this.observedValuesVariance;
        this.observedValuesVariance += varianceDelta / this.observedValuesCount;
        this.context.interaction.updateVolumeVizVisibilityThresholdBounds();
    }

    private updateStatisticalColormapBounds() {
        const standardDeviation = Math.sqrt(this.observedValuesVariance);
        this.statisticalColormapLowerBound = Math.max(this.observedValuesMean - (2.5 * standardDeviation), this.observedMinValue);
        this.statisticalColormapUpperBound = Math.min(this.observedValuesMean + (2.5 * standardDeviation), this.observedMaxValue);
    }

    resetDataStatistics() {
        this.observedMinValue = Infinity;
        this.observedMaxValue = -Infinity;
        this.observedValuesCount = 0;
        this.observedValuesMean = 0;
        this.observedValuesVariance = 0;
        this.statisticalColormapLowerBound = 0;
        this.statisticalColormapUpperBound = 0;
    }

    resetTextureFiltering() {
        this.storage.resetTextureFiltering();
    }

    // --- Tile receive (main orchestrator) ---

    async receiveTile(tile: Tile2D | Tile3D, data: ArrayBuffer, intention: TileRequestIntention) {
        const is2d = tile instanceof Tile2D;
        const is3d = tile instanceof Tile3D;

        if (intention == TileRequestIntention.ParseForTimeSeries && !is2d) {
            return console.error("Time series parsing is only supported for 2D tiles");
        }
        const forTimeSeries = (intention == TileRequestIntention.ParseForTimeSeries) && is2d;

        if (tile.cubeId != this.context.interaction.selectedCube.id || tile.parameter != this.context.interaction.selectedParameterId) {
            this.context.log("Received outdated tile (cube and/or parameter has changed)")
            return;
        }

        if (intention == TileRequestIntention.Visualization) {
            if (is2d && tile.indexValue != this.context.interaction.cubeSelection.getGuaranteedSparsityValidIndexValueForFace(tile.face)) {
                this.context.log("Receive outdated tile (index value has changed)");
                this.setTileDownloadFinished(tile);
                return;
            }

            if (is2d && !this.context.rendering.tileContainedInTileTextureView2d(tile)) {
                console.error("Received 2D tile not contained in current tile texture view", tile.toString());
                this.setTileDownloadFinished(tile);
                return;
            }

            if (is3d && !this.context.rendering.tileContainedInTileTextureView3d(tile)) {
                console.error("Received 3D tile not contained in current tile texture view", tile.toString());
                this.setTileDownloadFinished(tile);
                if (this.storage.areTiles3dDownloadsComplete()) {
                    this.context.rendering.revealLod3d();
                    this.context.rendering.setAllTilesDownloaded();
                    this.colormapHasChanged(true, false);
                }
                return;
            }

            if (is2d) {
                this.storage.allocateTexture2d(tile.face, tile.lod);
            } else {
                this.storage.allocateTexture3d(tile.lod);
            }
        }

        // Decompress
        let decompressionResult: DecompressedTileResult;
        try {
            decompressionResult = await this.decompressor.decompressTile(tile, data, this.context.debugMode);
        } catch (error) {
            if (is2d) {
                console.error(`Tile2D (${CubeFace[tile.face]}) at ${tile.indexValue} with LoD ${tile.lod} and x: ${tile.x} y: ${tile.y} with intention ${TileRequestIntention[intention]} failed to decode:`, error);
                this.storage.tile2dDecodesFailed += 1;
            } else {
                console.error(`Tile3D with LoD ${tile.lod} and x: ${tile.x} y: ${tile.y} z: ${tile.z} with intention ${TileRequestIntention[intention]} failed to decode:`, error);
                this.storage.tile3dDecodesFailed += 1;
            }
            this.updateStatusMessage();
            return;
        }

        if (!decompressionResult || !decompressionResult.validTile) {
            // Header validation failed (logged inside decompressor)
            return;
        }

        const timeSeriesStorageTarget = forTimeSeries ? new Float32Array(TILE_SIZE_2D * TILE_SIZE_2D).fill(NaN) : undefined;

        if (decompressionResult.isNanTile) {
            if (intention == TileRequestIntention.Visualization) {
                if (is2d) {
                    this.storage.putNaNTile2dInStorage(tile);
                } else {
                    this.storage.putNaNTile3dInStorage(tile);
                }
            }
        } else {
            if (intention == TileRequestIntention.Visualization) {
                this.updateStatisticalMeasures(decompressionResult.tileMin!, decompressionResult.tileMax!, decompressionResult.tileMean!, decompressionResult.tileVariance!);
            }

            this.storage.maxCompressionErrors.set(tile.getHashKey(), decompressionResult.maxError!);

            try {
                if (decompressionResult.lossless) {
                    if (is3d) {
                        this.storage.putTile3dInStorage(tile, decompressionResult.tileData!.buffer, decompressionResult.nanOrQuantileMask!.buffer, false, decompressionResult.expectedDtype);
                    } else if (decompressionResult.resampleResolution == 1) {
                        this.storage.putTile2dInStorage(tile, decompressionResult.tileData!.buffer, undefined, true, timeSeriesStorageTarget, decompressionResult.expectedDtype);
                    } else {
                        this.storage.putResampledTile2dInStorage(tile, decompressionResult.tileData!.buffer, undefined, decompressionResult.resampleResolution!, true, timeSeriesStorageTarget, decompressionResult.expectedDtype);
                    }
                } else {
                    if (is3d) {
                        this.storage.putTile3dInStorage(tile, decompressionResult.tileData!.buffer, decompressionResult.nanOrQuantileMask!.buffer, false, decompressionResult.expectedDtype);
                    } else if (decompressionResult.resampleResolution == 1) {
                        this.storage.putTile2dInStorage(tile, decompressionResult.tileData!.buffer, decompressionResult.nanOrQuantileMask!.buffer, false, timeSeriesStorageTarget, decompressionResult.expectedDtype);
                    } else {
                        this.storage.putResampledTile2dInStorage(tile, decompressionResult.tileData!.buffer, decompressionResult.nanOrQuantileMask!.buffer, decompressionResult.resampleResolution!, false, timeSeriesStorageTarget, decompressionResult.expectedDtype);
                    }
                }
            } catch (error) {
                if (is2d) {
                    console.error(`Tile2D (${CubeFace[tile.face]}) at ${tile.indexValue} with LoD ${tile.lod} and x: ${tile.x} y: ${tile.y} with intention ${TileRequestIntention[intention]} failed to decode:`, error);
                    this.storage.tile2dDecodesFailed += 1;
                } else {
                    console.error(`Tile3D with LoD ${tile.lod} and x: ${tile.x} y: ${tile.y} z: ${tile.z} with intention ${TileRequestIntention[intention]} failed to decode:`, error);
                    this.storage.tile3dDecodesFailed += 1;
                }
                this.updateStatusMessage();
                return;
            }
        }

        // release buffer if necessary
        decompressionResult.releaseBuffer?.();

        this.setTileDownloadFinished(tile);

        if (forTimeSeries) {
            if (!timeSeriesStorageTarget) {
                return console.error("Internal error: time series storage target not defined for time series tile request");
            }
            this.updateTimeSeriesData(tile, timeSeriesStorageTarget);
        }

        const multiBlockRendered = this.context.rendering.is3dLodMultiBlockRendered(tile.lod) && is3d;

        if (intention == TileRequestIntention.Visualization) {
            this.updateStatisticalColormapBounds();

            if (is2d) {
                this.storage.updateTextureForTile2d(tile);
                if (this.storage.areTiles2dDownloadsCompleteForFace(tile.face)) {
                    this.context.rendering.revealLod2dForFace(tile.face);
                }
                if (tile.lod == this.context.rendering.getCurrentlyShownLodForFace(tile.face)) {
                    this.context.rendering.showDataForFace(tile.face);
                }
            } else {
                this.storage.updateTextureForTile3d(tile);
                if (this.storage.areTiles3dDownloadsComplete()) {
                    this.context.rendering.revealLod3d();
                }
            }
        }

        if (multiBlockRendered) {
            console.log(`#### Received tile for multi-block volume rendering: `, tile);
            this.context.rendering.renderMultiBlockPassIfReady(tile);
        }

        const lastDownload = is2d ?
            this.storage.totalTiles2dDownloadsTriggered() == this.storage.totalTiles2dDownloadsFinished() :
            this.storage.totalTiles3dDownloadsTriggered() == this.storage.totalTiles3dDownloadsFinished();

        if (lastDownload) {
            this.context.rendering.setAllTilesDownloaded();
        }

        if (lastDownload || this.context.widgetMode) {
            if (this.lastObservedMaxValue == this.observedMaxValue && this.lastObservedMinValue == this.observedMinValue) {
                return;
            }
            this.lastObservedMaxValue = this.observedMaxValue;
            this.lastObservedMinValue = this.observedMinValue;
            this.colormapHasChanged(true, false);
        }
    }

    // --- Time series ---

    updateTimeSeriesData(tile: Tile2D, values: Float32Array | null) {
        const applicableTimeSeries = this.tileToTimeSeriesMap.get(tile.getHashKey());
        if (!applicableTimeSeries) {
            console.error("No applicable time series found for tile:", tile.toString());
            return;
        }
        const timeSeriesId = applicableTimeSeries.shift()!;

        if (tile.lod != 0) {
            console.error("Time series extraction only supported for LoD 0 tiles, got LoD", tile.lod, "for tile:", tile.toString());
            return;
        }
        const timeSeriesChunkOffset = tile.y * TILE_SIZE_2D;
        const timeSeriesChunk = new Array<number>(TILE_SIZE_2D).fill(NaN);
        if (values) {
            const timeSeries = this.context.interaction.getTimeSeries(timeSeriesId)!;
            if (!timeSeries) {
                return console.error("No time series found for ID:", timeSeriesId);
            }
            const localX = timeSeries.y - tile.x * TILE_SIZE_2D;
            for (let localY = 0; localY < TILE_SIZE_2D; localY++) {
                timeSeriesChunk[localY] = values[localX + localY * TILE_SIZE_2D];
            }
        }
        this.context.interaction.updateTimeSeriesData(timeSeriesId, timeSeriesChunk, timeSeriesChunkOffset);
    }

    requestTimeSeriesData(timeSeriesId: number, request: { indexDimension: Dimension; globalX: number; globalY: number; }, timeSeriesDimensionRange: ParameterRange) {
        const tiles = [];
        const tileX = Math.floor(request.globalY / TILE_SIZE_2D);
        const indexValue = request.globalX;
        const minTileY = Math.floor(timeSeriesDimensionRange.min / TILE_SIZE_2D);
        const maxTileY = Math.ceil(timeSeriesDimensionRange.max / TILE_SIZE_2D);

        for (let tileY = minTileY; tileY < maxTileY; tileY++) {
            const t = new Tile2D(CubeFace.Left, indexValue, 0, tileX, tileY, this.context.interaction.selectedCube.id, this.context.interaction.selectedParameterId);
            tiles.push(t);
            const key = t.getHashKey();
            if (this.tileToTimeSeriesMap.has(key)) {
                this.tileToTimeSeriesMap.get(key)!.push(timeSeriesId);
            } else {
                this.tileToTimeSeriesMap.set(key, [timeSeriesId]);
            }
        }
        this.context.networking.downloadTiles(tiles, TileRequestIntention.ParseForTimeSeries);
    }

    // --- Colormap ---

    colormapHasChanged(optionsChanged: boolean, colormapChanged: boolean) {
        if (optionsChanged) {
            let minValue = this.observedMinValue;
            let maxValue = this.observedMaxValue;
            let changeScaleTexts = true;
            if (minValue == Infinity && maxValue == -Infinity) {
                changeScaleTexts = false;
            }
            if (this.colormapUseStandardDeviation && !this.ignoreStatisticalColormapBounds) {
                minValue = this.statisticalColormapLowerBound;
                maxValue = this.statisticalColormapUpperBound;
            }
            if (this.colormapMinValueOverride !== null) {
                minValue = this.colormapMinValueOverride;
            }
            if (this.colormapMaxValueOverride !== null) {
                maxValue = this.colormapMaxValueOverride;
            }

            if (this.symmetricalColormapAroundZero) {
                const largerValue = Math.max(Math.abs(minValue), Math.abs(maxValue));
                minValue = -largerValue;
                maxValue = largerValue;
            }

            this.colormapMinValue = minValue;
            this.colormapMaxValue = maxValue;
            const targetPrecision = this.context.interaction.getColormapMinMaxValuePrecision();
            if (targetPrecision < Infinity) {
                if (this.colormapMinValueOverride === null) {
                    this.colormapMinValue = Math.round(this.colormapMinValue * 10**targetPrecision) / 10**targetPrecision;
                }
                if (this.colormapMaxValueOverride === null) {
                    this.colormapMaxValue = Math.round(this.colormapMaxValue * 10**targetPrecision) / 10**targetPrecision;
                }
            }
            this.context.log("Colormap options changed", this.colormapMinValue, this.colormapMaxValue, this.colormapFlipped);
            this.context.rendering.updateColormapOptions(this.colormapMinValue, this.colormapMaxValue, this.colormapFlipped);
            if (changeScaleTexts) {
                this.context.interaction.updateColormapScaleTexts(this.colormapMinValue, this.colormapMaxValue);
            }
            this.context.interaction.updateColormapRangePlaceholders();
            this.context.interaction.updateVolumeVizVisibilityThresholdBounds();

            if (this.context.orchestrationMasterMode) {
                this.context.networking.pushOrchestratorColormapOptionsUpdate(this.colormapMinValue, this.colormapMaxValue, this.colormapFlipped);
            }
        }

        if (colormapChanged) {
            this.context.log("Colormap texture changed")
            this.colormap.updateFastColormap();
            this.context.rendering.updateColormapTexture(this.colormap.getFastColormapTexture());
        }
        if (optionsChanged || colormapChanged) {
            this.context.rendering.requestRender();
        }
    }

    setColormapFlipped(flipped: boolean) {
        this.colormapFlipped = flipped;
        this.context.interaction.updateColormapScaleFlip(flipped);
    }

    getColormapFlipped() {
        return this.colormapFlipped;
    }

    selectColormapByName(name: string) {
        try {
            const colormapData = this.context.interaction.getColormapDataFromName(name);
            this.selectColormapByData(colormapData, name);

            if (this.context.orchestrationMasterMode) {
                this.context.networking.pushOrchestratorColormapNameUpdate(name);
            }
            return true;
        } catch (error) {
            this.context.log("Failed to select colormap", name, error);
            return false;
        }
    }

    selectColormapByData(data: Array<Array<number>>, name?: string) {
        if (!this.colormap.setFromData(data, name)) {
            return false;
        }
        this.colormapHasChanged(false, true);
        return true;
    }

    // --- Status ---

    updateStatusMessage() {
        if (!this.context.widgetMode) {
            const triggered2d = this.storage.totalTiles2dDownloadsTriggered();
            const finished2d = this.storage.totalTiles2dDownloadsFinished();
            const triggered3d = this.storage.totalTiles3dDownloadsTriggered();
            const finished3d = this.storage.totalTiles3dDownloadsFinished();
            this.context.interaction.updateStatusMessage(triggered2d + triggered3d, finished2d + finished3d, 0, 0);
        }
    }

    // --- Facade: delegated storage methods ---

    get3dStorageType(): string {
        return this.storage.get3dStorageType();
    }

    getActual3dStorageSizeOfLodInBytes(): StorageUsage {
        return this.storage.getActual3dStorageSizeOfLodInBytes();
    }

    getTheoretical3dStorageSizeOfLodInBytes(lod: number): StorageUsage {
        return this.storage.getTheoretical3dStorageSizeOfLodInBytes(lod);
    }

    setDataType(valueType: DataType) {
        this.storage.setDataType(valueType);
    }

    allocateTile2dStorages(forceStorageRecreation: boolean = false) {
        this.storage.allocateTile2dStorages(forceStorageRecreation);
    }

    allocateTile3dStorages(forceStorageRecreation: boolean = false) {
        this.storage.allocateTile3dStorages(forceStorageRecreation);
    }

    resetTileMaps() {
        this.storage.resetTileMaps();
    }

    getTile2dDataValue(face: CubeFace, lod: number, tileX: number, tileY: number, pixelX: number, pixelY: number) {
        return this.storage.getTile2dDataValue(face, lod, tileX, tileY, pixelX, pixelY);
    }

    getTile3dDataValue(lod: number, tileX: number, tileY: number, tileZ: number, pixelX: number, pixelY: number, pixelZ: number) {
        return this.storage.getTile3dDataValue(lod, tileX, tileY, tileZ, pixelX, pixelY, pixelZ);
    }

    isTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        return this.storage.isTileDownloadFinished(tile);
    }

    isTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        return this.storage.isTileDownloadTriggered(tile);
    }

    setTileDownloadTriggered(tile: (Tile2D | Tile3D)) {
        this.storage.setTileDownloadTriggered(tile);
        this.updateStatusMessage();
    }

    setTileDownloadFinished(tile: (Tile2D | Tile3D)) {
        this.storage.setTileDownloadFinished(tile);
        this.updateStatusMessage();
    }

    resetTile2dDownloadMapsForFace(face: CubeFace) {
        this.storage.resetTile2dDownloadMapsForFace(face);
    }

    resetTile3dDownloadMapsForLod(lod: number) {
        this.storage.resetTile3dDownloadMapsForLod(lod);
    }

    resetTileDownloadMapsAfterTileTextureView2dUpdate(face: CubeFace, lod: number, previousOffset: Vector2) {
        this.storage.resetTileDownloadMapsAfterTileTextureView2dUpdate(face, lod, previousOffset);
    }

    resetTileDownloadMapsAfterTileTextureView3dUpdate(lod: number, previousOffset: Vector3) {
        this.storage.resetTileDownloadMapsAfterTileTextureView3dUpdate(lod, previousOffset);
    }

    moveTileStorageDataAfterTileTextureView2dUpdate(face: CubeFace, lod: number, updateResult: TileTextureView2DUpdateResult) {
        this.storage.moveTileStorageDataAfterTileTextureView2dUpdate(face, lod, updateResult);
    }

    moveTileStorageDataAfterTileTextureView3dUpdate(lod: number, updateResult: TileTextureView3DUpdateResult) {
        this.storage.moveTileStorageDataAfterTileTextureView3dUpdate(lod, updateResult);
    }
}


export { TileData, Tile2D, Tile3D, Tile3DClipBoundary }
