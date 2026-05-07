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

import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    Object3D,
    Plane,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three';
import { Remote, wrap } from 'comlink';
import { CubeFace, Dimension, range } from '../constants';
import { CubeClientContext } from '../client';
import FastLineSegmentMap from './fast-line-segment-map';
import { GeoJSONWorkerApi } from './geojson-loader.worker';

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

    private regionBordersDistanceFromCubeCenterInRenderWorld = new Vector3(0.501, 0.501, 0.501); // just a bit in front of the cube
    private regionBordersDistanceFromCubeCenterOffset: number = 0.001;

    private regionBordersSideMaterial!: LineBasicMaterial;
    private regionBordersSideParent!: Object3D;

    private regionBordersSidePlanes: Map<CubeFace, Plane> = new Map<CubeFace, Plane>();
    private regionBordersSideLines: Map<CubeFace, LineSegments> = new Map<CubeFace, LineSegments>();
    private regionBordersSideLinesInitialPoolAmount = 200;

    private lastSideRegionXLeft = 0;
    private lastSideRegionXRight = 0;
    private lastSideRegionYTop = 0;
    private lastSideRegionYBottom = 0;

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

        const scale = this.host.getCubeScaleInRenderWorld();
        this.regionBordersDistanceFromCubeCenterInRenderWorld = scale
            .clone()
            .multiplyScalar(0.5)
            .addScalar(this.regionBordersDistanceFromCubeCenterOffset); // just a bit in front of the cube, based on its scale

        this.regionBordersSidePlanes.set(
            CubeFace.Top,
            new Plane(new Vector3(0, 1, 0), this.regionBordersDistanceFromCubeCenterInRenderWorld.y)
        );
        this.regionBordersSidePlanes.set(
            CubeFace.Bottom,
            new Plane(
                new Vector3(0, -1, 0),
                this.regionBordersDistanceFromCubeCenterInRenderWorld.y
            )
        );
        this.regionBordersSidePlanes.set(
            CubeFace.Left,
            new Plane(new Vector3(0, 0, 1), this.regionBordersDistanceFromCubeCenterInRenderWorld.z)
        );
        this.regionBordersSidePlanes.set(
            CubeFace.Right,
            new Plane(
                new Vector3(0, 0, -1),
                this.regionBordersDistanceFromCubeCenterInRenderWorld.z
            )
        );

        this.regionBordersSideParent = new Object3D();
        this.scene.add(this.regionBordersSideParent);

        this.regionBordersFrontMaterial = new LineBasicMaterial({
            linewidth: 1,
            transparent: true,
            color: 'black',
            opacity: this.regionBordersTransparency,
            clippingPlanes: Array.from(this.regionBordersSidePlanes.values()),
        });

        this.regionBordersSideMaterial = new LineBasicMaterial({
            linewidth: 1,
            color: 'black',
            transparent: true,
            opacity: this.regionBordersTransparency,
        });

        for (let face of [CubeFace.Top, CubeFace.Bottom, CubeFace.Left, CubeFace.Right]) {
            const lines = this.createSideLines(face);
            this.regionBordersSideLines.set(face, lines);
            this.regionBordersSideParent.add(lines);
        }

        this.regionBordersFrontParent = new Object3D();
        this.scene.add(this.regionBordersFrontParent);
        renderer.localClippingEnabled = true;
    }

    getSidePlanes() {
        return this.regionBordersSidePlanes;
    }

    getFrontMaterial() {
        return this.regionBordersFrontMaterial;
    }

    getSideMaterial() {
        return this.regionBordersSideMaterial;
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
        this.regionBordersSideMaterial.color.set(color);
        this.regionBordersFrontMaterial.needsUpdate = true;
        this.regionBordersSideMaterial.needsUpdate = true;
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
            featureIdToProperties,
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

    updateSideBorders(
        xLeft: number,
        xRight: number,
        yTop: number,
        yBottom: number,
        worldSizeX: number
    ) {
        if (!this.regionBordersFrontActiveLocalParent) {
            return;
        }

        const faceChanged = [
            this.lastSideRegionYTop != yTop, // top 2
            this.lastSideRegionYBottom != yBottom, // bottom 3
            this.lastSideRegionXLeft != xLeft, // left 4
            this.lastSideRegionXRight != xRight, // right 5
        ];

        faceChanged[0] = faceChanged[0] || faceChanged[2] || faceChanged[3]; // top face is influenced by top, left, and right, but NOT bottom
        faceChanged[1] = faceChanged[1] || faceChanged[2] || faceChanged[3]; // bottom face is influenced by bottom, left, and right, but NOT top
        faceChanged[2] = faceChanged[2] || faceChanged[0] || faceChanged[1]; // left face is influenced by left, top, and bottom, but NOT right
        faceChanged[3] = faceChanged[3] || faceChanged[0] || faceChanged[1]; // right face is influenced by right, top, and bottom, but NOT left

        const refreshEverything =
            this.host.printTemplateDownloading || this.host.printTemplateJustDownloaded;
        const skipCubeOffset = this.host.printTemplateDownloading;

        const frontLineSegments = this.regionBordersFrontActiveLocalParent.children[0]
            .children[0] as LineSegments;
        const frontLinePositions = frontLineSegments.geometry.attributes.position.array;
        const centerX = (xLeft + xRight) / 2;
        const centerY = (yTop + yBottom) / 2;
        const xLeftAdjusted = skipCubeOffset
            ? xLeft
            : centerX + (xLeft - centerX) * (1 + this.regionBordersDistanceFromCubeCenterOffset);
        const xRightAdjusted = skipCubeOffset
            ? xRight
            : centerX + (xRight - centerX) * (1 + this.regionBordersDistanceFromCubeCenterOffset);
        const yTopAdjusted = skipCubeOffset
            ? yTop
            : centerY + (yTop - centerY) * (1 + this.regionBordersDistanceFromCubeCenterOffset);
        const yBottomAdjusted = skipCubeOffset
            ? yBottom
            : centerY + (yBottom - centerY) * (1 + this.regionBordersDistanceFromCubeCenterOffset);

        const minZ = -xRightAdjusted;
        const maxZ = -xLeftAdjusted;
        const topIsMaxY = yTopAdjusted > yBottomAdjusted; // is this always true?
        const minY = topIsMaxY ? yBottomAdjusted : yTopAdjusted;
        const maxY = topIsMaxY ? yTopAdjusted : yBottomAdjusted;

        const dimensionOverflow = this.host.dimensionOverflow;

        const normalizeZForOverflow = (z: number) => {
            if (dimensionOverflow[Dimension.X] && z < -worldSizeX / 2) {
                return z + worldSizeX;
            }
            return z;
        };

        for (let face = 2; face < 6; face++) {
            if (!faceChanged[face - 2] && !refreshEverything) {
                continue;
            }
            if (!this.host.faceVisibility[face]) {
                continue;
            }
            const sideLines = this.regionBordersSideLines.get(face)!;
            sideLines.visible = true;
            const intersectingSegments: Vector3[] = [];

            if (face == CubeFace.Left || face == CubeFace.Right) {
                const zCutoff = normalizeZForOverflow(face == CubeFace.Left ? maxZ : minZ);
                const filteredFrontLineIndices = (
                    this.regionBordersFrontActiveLocalParent.userData
                        .lineSegmentMapZ as FastLineSegmentMap
                ).getAllIndicesAtValue(zCutoff);
                for (let i = 0; i < filteredFrontLineIndices.length; i += 2) {
                    const p1index = filteredFrontLineIndices[i] * 3;
                    const p2index = filteredFrontLineIndices[i + 1] * 3;
                    const p1Y = frontLinePositions[p1index + 1];
                    const p1Z = frontLinePositions[p1index + 2];
                    const p2Y = frontLinePositions[p2index + 1];
                    const p2Z = frontLinePositions[p2index + 2];

                    // Check if the segment crosses the cutoff plane
                    if ((p1Z < zCutoff && p2Z > zCutoff) || (p1Z > zCutoff && p2Z < zCutoff)) {
                        const t = (zCutoff - p1Z) / (p2Z - p1Z);
                        const intersection = new Vector3(0, p1Y + t * (p2Y - p1Y), zCutoff);
                        if (intersection.y < minY || intersection.y > maxY) {
                            continue;
                        }
                        intersectingSegments.push(intersection);
                    }
                }
            } else {
                const yCutoff = face == CubeFace.Top ? maxY : minY;
                const filteredFrontLineIndices = (
                    this.regionBordersFrontActiveLocalParent.userData
                        .lineSegmentMapY as FastLineSegmentMap
                ).getAllIndicesAtValue(yCutoff);

                for (let i = 0; i < filteredFrontLineIndices.length; i += 2) {
                    const p1index = filteredFrontLineIndices[i] * 3;
                    const p2index = filteredFrontLineIndices[i + 1] * 3;
                    const p1Y = frontLinePositions[p1index + 1];
                    const p2Y = frontLinePositions[p2index + 1];
                    let p1Z = frontLinePositions[p1index + 2];
                    let p2Z = frontLinePositions[p2index + 2];

                    // Check if the segment crosses the cutoff plane
                    if ((p1Y < yCutoff && p2Y > yCutoff) || (p1Y > yCutoff && p2Y < yCutoff)) {
                        const t = (yCutoff - p1Y) / (p2Y - p1Y);
                        const intersection = new Vector3(0, yCutoff, p1Z + t * (p2Z - p1Z));

                        if (dimensionOverflow[Dimension.X] && intersection.z > maxZ) {
                            intersection.z -= worldSizeX;
                        }

                        if (intersection.z < minZ || intersection.z > maxZ) {
                            continue;
                        }
                        intersectingSegments.push(intersection);
                    }
                }
            }

            const positions = sideLines.geometry.attributes.position;
            let lineAmount = positions.count / 2;

            const intersectingAmount = intersectingSegments.length;
            if (intersectingAmount > lineAmount) {
                const newLineAmount = intersectingAmount + 20;
                this.context.log(
                    'Increasing side region border line pool from ',
                    lineAmount,
                    'to',
                    newLineAmount
                );
                const newPositions = this.createSideLinePositions(face, newLineAmount);
                sideLines.geometry.setAttribute(
                    'position',
                    new Float32BufferAttribute(newPositions, 3)
                );
                lineAmount = newLineAmount;
            }
            const smallerLimit = Math.min(lineAmount, intersectingAmount);

            if (face == CubeFace.Left || face == CubeFace.Right) {
                for (let i = 0; i < smallerLimit; i++) {
                    const y = this.regionBordersFrontParent.localToWorld(intersectingSegments[i]).y;
                    positions.setY(i * 2, y);
                    positions.setY(i * 2 + 1, y);
                }
            } else {
                for (let i = 0; i < smallerLimit; i++) {
                    const z = this.regionBordersFrontParent.localToWorld(intersectingSegments[i]).z;
                    positions.setZ(i * 2, z);
                    positions.setZ(i * 2 + 1, z);
                }
            }
            const newIndex = range(0, smallerLimit * 2 - 1);
            sideLines.geometry.setIndex(newIndex);
            sideLines.geometry.attributes.position.needsUpdate = true;
            sideLines.geometry.index!.needsUpdate = true;

            switch (face) {
                case CubeFace.Top:
                    this.lastSideRegionYTop = yTop;
                    break;
                case CubeFace.Bottom:
                    this.lastSideRegionYBottom = yBottom;
                    break;
                case CubeFace.Left:
                    this.lastSideRegionXLeft = xLeft;
                    break;
                case CubeFace.Right:
                    this.lastSideRegionXRight = xRight;
                    break;
            }
        }
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
                this.regionBordersDistanceFromCubeCenterInRenderWorld.x *
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

        this.updateSideBorders(
            xSelectedRange.getFirst(),
            xSelectedRange.getLast(),
            ySelectedRange.getFirst(),
            ySelectedRange.getLast(),
            datasetSize.x
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

    private createSideLinePositions(face: CubeFace, lineAmount: number) {
        const y =
            face == CubeFace.Top
                ? this.regionBordersDistanceFromCubeCenterInRenderWorld.y
                : face == CubeFace.Bottom
                ? -this.regionBordersDistanceFromCubeCenterInRenderWorld.y
                : 0;
        const z =
            face == CubeFace.Left
                ? this.regionBordersDistanceFromCubeCenterInRenderWorld.z
                : face == CubeFace.Right
                ? -this.regionBordersDistanceFromCubeCenterInRenderWorld.z
                : 0;
        const positions: number[] = range(0, lineAmount * 6 - 1).map((i) =>
            i % 3 == 0
                ? Math.floor(i / 3) % 2 == 0
                    ? -this.regionBordersDistanceFromCubeCenterInRenderWorld.x
                    : this.regionBordersDistanceFromCubeCenterInRenderWorld.x
                : i % 3 == 1
                ? y
                : z
        );
        return positions;
    }

    private createSideLines(face: CubeFace) {
        const indices: number[] = [0, 1];
        const positions = this.createSideLinePositions(
            face,
            this.regionBordersSideLinesInitialPoolAmount
        );
        const geometry = new BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();

        const lineSegments = new LineSegments(geometry, this.regionBordersSideMaterial);
        lineSegments.visible = false;
        return lineSegments;
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
