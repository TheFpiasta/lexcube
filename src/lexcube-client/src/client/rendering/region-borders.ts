import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    Object3D,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three';
import { Remote, wrap } from 'comlink';
import { CubeFace, Dimension } from '../constants';
import { CubeClientContext } from '../client';
import FastLineSegmentMap from './fast-line-segment-map';
import { GeoJSONWorkerApi } from './geojson-loader.worker';
import { RegionBorderSideGeometry } from './region-border-side-geometry';

enum NaturalEarthRegionBorderResolution {
    'Highest' = 10,
    'High' = 50,
    'Default' = 110,
}

interface RegionBorderHostState {
    faceVisibility: boolean[];
    dimensionOverflow: boolean[];
    printTemplateDownloading: boolean;
    printTemplateJustDownloaded: boolean;
    getCubeScaleInRenderWorld: () => Vector3;
    requestRender(hasDataOrDataSelectionChanged: boolean): void;
}

class RegionBorderManager {
    private context: CubeClientContext;
    private scene: Scene;
    private host: RegionBorderHostState;

    private regionBordersTransparency: number = 0.6;
    private regionBordersFrontMaterial!: LineBasicMaterial;
    private regionBordersFrontParent!: Object3D;
    private regionBordersFrontActiveLocalParent!: Object3D;
    private regionBordersFrontAtDifferentResolutions: Map<
        NaturalEarthRegionBorderResolution,
        Object3D
    > = new Map<NaturalEarthRegionBorderResolution, Object3D>();
    private currentRegionBorderResolution = 0;
    private regionBorderResolutionsBeingLoaded = new Set<NaturalEarthRegionBorderResolution>();
    private regionBorderFrontSegmentMapBins = 100000;

    private sideGeometry: RegionBorderSideGeometry;

    private geoJsonLoaderWorker: Worker | null = null;
    private geoJsonLoaderService: Remote<GeoJSONWorkerApi> | null = null;

    private regionBordersJustLoaded = false;

    constructor(
        context: CubeClientContext,
        scene: Scene,
        renderer: WebGLRenderer,
        host: RegionBorderHostState
    ) {
        this.context = context;
        this.scene = scene;
        this.host = host;

        this.sideGeometry = new RegionBorderSideGeometry(
            context,
            scene,
            host,
            this.host.getCubeScaleInRenderWorld(),
            this.regionBordersTransparency
        );

        this.regionBordersFrontMaterial = new LineBasicMaterial({
            linewidth: 1,
            transparent: true,
            color: 'black',
            opacity: this.regionBordersTransparency,
            clippingPlanes: Array.from(this.sideGeometry.getSidePlanes().values()),
        });

        this.regionBordersFrontParent = new Object3D();
        this.scene.add(this.regionBordersFrontParent);
        renderer.localClippingEnabled = true;
    }

    getSidePlanes() {
        return this.sideGeometry.getSidePlanes();
    }

    getFrontMaterial() {
        return this.regionBordersFrontMaterial;
    }

    getSideMaterial() {
        return this.sideGeometry.getSideMaterial();
    }

    getFrontParent() {
        return this.regionBordersFrontParent;
    }

    loadFromGeoJsonForWidget(geojson: any, color: string = '') {
        this.context.log('Loading GeoJSON for widget', geojson);
        this.loadRegionBorders(NaturalEarthRegionBorderResolution.Default, geojson);
        if (color) {
            this.setColor(color);
        }
    }

    clearForWidget() {
        this.clearRegionBorders();
    }

    setColor(color: string) {
        this.regionBordersFrontMaterial.color.set(color);
        this.regionBordersFrontMaterial.needsUpdate = true;
        this.sideGeometry.setColor(color);
        this.host.requestRender(false);
    }

    private async loadRegionBorders(
        newResolution: NaturalEarthRegionBorderResolution = NaturalEarthRegionBorderResolution.Default,
        geojson: any = null
    ) {
        this.context.log(`Loading region borders at resolution: ${newResolution}`);
        this.regionBordersJustLoaded = true;
        if (this.context.widgetMode) {
            this.clearRegionBorders();
            const localParent = await this.loadFromGeoJson(geojson);
            this.activateFrontLocalParent(localParent!);
        } else {
            await this.loadFromNaturalEarth(newResolution);
        }
        this.updatePositionAndResolution();
        this.host.requestRender(false);
        this.regionBordersJustLoaded = false;
    }

    private async loadFromNaturalEarth(targetResolution: NaturalEarthRegionBorderResolution) {
        if (this.regionBordersFrontAtDifferentResolutions.has(targetResolution)) {
            this.context.log(
                `Region borders at resolution ${targetResolution} already loaded, making them visible`
            );
            const localParent =
                this.regionBordersFrontAtDifferentResolutions.get(targetResolution)!;
            localParent.visible = true;
            this.activateFrontLocalParent(localParent);
        } else {
            if (this.regionBorderResolutionsBeingLoaded.size > 0) {
                return false;
            }
            this.regionBorderResolutionsBeingLoaded.add(targetResolution);
            const localParent = await this.loadFromGeoJson(
                this.context.networking.getFetchUrl(
                    `/ne_${targetResolution}m_admin_0_countries.geojson`
                )
            );
            this.regionBordersFrontAtDifferentResolutions.set(targetResolution, localParent!);
            this.regionBorderResolutionsBeingLoaded.delete(targetResolution);
            this.activateFrontLocalParent(localParent!);
        }
        this.currentRegionBorderResolution = targetResolution;
        this.regionBordersFrontAtDifferentResolutions.forEach((localParent, resolution) => {
            if (resolution != targetResolution) {
                this.context.log(`Hiding region borders at resolution ${resolution}`);
                localParent.visible = false;
            }
        });
        return true;
    }

    private activateFrontLocalParent(localParent: Object3D) {
        this.regionBordersFrontActiveLocalParent = localParent;
        this.context.rendering.setActivePolygonFeatureMap(
            localParent.userData.featurePolygonMap,
            localParent.userData.featurePolygonMapWidth,
            localParent.userData.featurePolygonMapHeight,
            localParent.userData.featurePolygonMapBounds
        );
    }

    private async clearRegionBorders() {
        this.regionBordersFrontParent.children.forEach((child) => {
            if (child instanceof LineSegments) {
                child.geometry.dispose();
            }
        });
        this.regionBordersFrontParent.remove(...this.regionBordersFrontParent.children);
    }

    private async loadFromGeoJson(geoJsonOrUrl: any) {
        if (!this.regionBordersFrontParent) {
            console.error('Region borders parent not initialized');
            return;
        }

        const geoJsonLoaderService = this.ensureGeoJsonLoaderService();
        const {
            indices,
            positions,
            lineSegmentMapY,
            lineSegmentMapZ,
            featurePolygonMap,
            geoJsonBounds,
            featurePolygonMapHeight,
            featurePolygonMapWidth,
        } = await geoJsonLoaderService.parseGeoJSON(
            geoJsonOrUrl,
            this.regionBorderFrontSegmentMapBins
        );

        const geometry = new BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();

        const lineSegments = new LineSegments(geometry, this.regionBordersFrontMaterial);
        const lineParent = new Object3D();
        const lineParentOverflow = new Object3D();
        lineParent.add(lineSegments);

        const localParent = new Object3D();
        localParent.add(lineParent);
        localParent.add(lineParentOverflow);
        localParent.userData = {
            lineSegmentMapZ: FastLineSegmentMap.fromObject(lineSegmentMapZ),
            lineSegmentMapY: FastLineSegmentMap.fromObject(lineSegmentMapY),
            featurePolygonMap: featurePolygonMap,
            featurePolygonMapHeight: featurePolygonMapHeight,
            featurePolygonMapWidth: featurePolygonMapWidth,
            featurePolygonMapBounds: geoJsonBounds,
            overflowActive: false,
            activateOverflow: () => {
                if (localParent.userData.overflowActive) {
                    return;
                }
                localParent.userData.overflowActive = true;
                this.context.log('Activating overflow for region borders');
                lineParentOverflow.add(lineSegments.clone());
            },
        };

        this.regionBordersFrontParent.add(localParent);
        return localParent;
    }

    async updatePositionAndResolution() {
        if (!this.context.interaction.cubeDimensions.isGeospatialContextValid()) {
            this.regionBordersFrontParent.visible = false;
            this.context.log('Geospatial context not provided, hiding region borders');
            return;
        }
        if (!this.regionBordersFrontParent) {
            return;
        }

        const indexValueLeft = this.context.interaction.cubeSelection.getIndexValueForFace(
            CubeFace.Left
        );
        const indexValueRight = this.context.interaction.cubeSelection.getIndexValueForFace(
            CubeFace.Right
        );
        const indexValueTop = this.context.interaction.cubeSelection.getIndexValueForFace(
            CubeFace.Top
        );
        const indexValueBottom = this.context.interaction.cubeSelection.getIndexValueForFace(
            CubeFace.Bottom
        );

        const xTotalRange = this.context.interaction.cubeDimensions.getGeospatialTotalRangeX();
        const yTotalRange = this.context.interaction.cubeDimensions.getGeospatialTotalRangeY();

        const xSelectedRange = this.context.interaction.cubeDimensions.getGeospatialSubRangeX(
            indexValueLeft,
            indexValueRight
        );
        const ySelectedRange = this.context.interaction.cubeDimensions.getGeospatialSubRangeY(
            indexValueTop,
            indexValueBottom
        );

        const selectionCenterPoint = new Vector2(xSelectedRange.middle(), ySelectedRange.middle());
        const selectionSize = new Vector2(xSelectedRange.range(), ySelectedRange.range());
        const datasetCenterPoint = new Vector2(xTotalRange.middle(), yTotalRange.middle());
        const datasetSize = new Vector2(xTotalRange.range(), yTotalRange.range());

        const zoomRelativeToDataset = new Vector2().copy(datasetSize).divide(selectionSize);
        const cubeScale = this.host.getCubeScaleInRenderWorld();
        zoomRelativeToDataset.x *= cubeScale.z;
        zoomRelativeToDataset.y *= cubeScale.y;

        const normalizationMatrix = new Matrix4() // normalizes GeoJSON that fits into the dataset bounds to [-0.5, 0.5] x [-0.5, 0.5]
            .multiply(new Matrix4().makeScale(1, 1 / yTotalRange.range(), 1 / xTotalRange.range()))
            .multiply(
                new Matrix4().makeTranslation(0, -datasetCenterPoint.y, -datasetCenterPoint.x)
            );

        const flippedForVolumeRender = 1; // this.volumeRenderingEnabled ? -1 : 1
        const finalMatrix = new Matrix4()
            .makeTranslation(
                this.sideGeometry.distanceFromCubeCenterInRenderWorld.x *
                    (this.host.faceVisibility[CubeFace.Back] ? -1 : 1) *
                    flippedForVolumeRender, // move to front or back depending on face visibility
                (-zoomRelativeToDataset.y * (selectionCenterPoint.y - datasetCenterPoint.y)) /
                    datasetSize.y, // positive data Y = positive global Y
                (zoomRelativeToDataset.x * (selectionCenterPoint.x + datasetCenterPoint.x)) /
                    datasetSize.x // positive data X = negative global Z
            )
            .multiply(new Matrix4().makeScale(1, zoomRelativeToDataset.y, zoomRelativeToDataset.x)) // apply zoom
            .multiply(normalizationMatrix);

        this.regionBordersFrontParent.visible = true;

        const dimensionOverflow = this.host.dimensionOverflow;
        if (
            dimensionOverflow[Dimension.X] &&
            this.regionBordersFrontActiveLocalParent &&
            this.regionBordersFrontActiveLocalParent.children.length > 0
        ) {
            if (!this.regionBordersFrontActiveLocalParent.userData.overflowActive) {
                this.regionBordersFrontActiveLocalParent.userData.activateOverflow();
            }
            const overflowOffsetZ = -datasetSize.x; // this used to be negative for zeroIndexGreenwich data sets, not sure why not anymore
            if (
                this.regionBordersFrontActiveLocalParent.children[1].position.z != overflowOffsetZ
            ) {
                this.regionBordersFrontActiveLocalParent.children[1].position.setZ(overflowOffsetZ);
            }
        }

        this.regionBordersFrontParent.matrixAutoUpdate = false;
        this.regionBordersFrontParent.matrix.identity();
        this.regionBordersFrontParent.applyMatrix4(finalMatrix);
        this.regionBordersFrontParent.updateMatrixWorld(true); // needs force. alternatively: .matrixWorldNeedsUpdate = true;

        this.sideGeometry.update(
            xSelectedRange.getFirst(),
            xSelectedRange.getLast(),
            ySelectedRange.getFirst(),
            ySelectedRange.getLast(),
            datasetSize.x,
            this.regionBordersFrontActiveLocalParent,
            this.regionBordersFrontParent
        );

        if (!this.context.widgetMode) {
            if (Math.max(zoomRelativeToDataset.x, zoomRelativeToDataset.y) > 100) {
                // hide region borders since we are all the way zoomed in
            } else {
                const zoomFactor = (zoomRelativeToDataset.x + zoomRelativeToDataset.y) / 2;
                let targetResolution =
                    zoomFactor > 5
                        ? NaturalEarthRegionBorderResolution.Highest
                        : zoomFactor > 2
                        ? NaturalEarthRegionBorderResolution.High
                        : NaturalEarthRegionBorderResolution.Default;
                if (this.context.orchestrationMinionMode) {
                    targetResolution = NaturalEarthRegionBorderResolution.Highest;
                }
                if (
                    this.currentRegionBorderResolution != targetResolution &&
                    !this.regionBordersJustLoaded
                ) {
                    await this.loadRegionBorders(targetResolution);
                }
            }
        }
    }

    private ensureGeoJsonLoaderService(): Remote<GeoJSONWorkerApi> {
        if (this.geoJsonLoaderService) {
            return this.geoJsonLoaderService;
        }

        this.geoJsonLoaderWorker = new Worker(
            new URL('./geojson-loader.worker.ts', import.meta.url),
            { type: 'module' }
        );
        this.geoJsonLoaderService = wrap<GeoJSONWorkerApi>(this.geoJsonLoaderWorker);
        return this.geoJsonLoaderService;
    }
}

export { RegionBorderManager, NaturalEarthRegionBorderResolution, RegionBorderHostState };
