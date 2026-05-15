import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Object3D,
    Plane,
    Scene,
    Vector3,
} from 'three';
import { CubeFace, Dimension, range } from '../constants';
import { CubeClientContext } from '../client';
import FastLineSegmentMap from './fast-line-segment-map';

export interface RegionBorderSideHostState {
    faceVisibility: boolean[];
    dimensionOverflow: boolean[];
    printTemplateDownloading: boolean;
    printTemplateJustDownloaded: boolean;
}

export class RegionBorderSideGeometry {
    private context: CubeClientContext;
    private host: RegionBorderSideHostState;

    private sideMaterial: LineBasicMaterial;
    private sideParent: Object3D;
    private sidePlanes: Map<CubeFace, Plane> = new Map<CubeFace, Plane>();
    private sideLines: Map<CubeFace, LineSegments> = new Map<CubeFace, LineSegments>();
    private sideLinesInitialPoolAmount = 200;

    distanceFromCubeCenterInRenderWorld: Vector3;
    distanceFromCubeCenterOffset: number;

    private lastXLeft = 0;
    private lastXRight = 0;
    private lastYTop = 0;
    private lastYBottom = 0;

    constructor(
        context: CubeClientContext,
        scene: Scene,
        host: RegionBorderSideHostState,
        cubeScale: Vector3,
        transparency: number,
        distanceFromCubeCenterOffset: number = 0.001
    ) {
        this.context = context;
        this.host = host;
        this.distanceFromCubeCenterOffset = distanceFromCubeCenterOffset;

        this.distanceFromCubeCenterInRenderWorld = cubeScale
            .clone()
            .multiplyScalar(0.5)
            .addScalar(this.distanceFromCubeCenterOffset);

        this.sidePlanes.set(
            CubeFace.Top,
            new Plane(new Vector3(0, 1, 0), this.distanceFromCubeCenterInRenderWorld.y)
        );
        this.sidePlanes.set(
            CubeFace.Bottom,
            new Plane(new Vector3(0, -1, 0), this.distanceFromCubeCenterInRenderWorld.y)
        );
        this.sidePlanes.set(
            CubeFace.Left,
            new Plane(new Vector3(0, 0, 1), this.distanceFromCubeCenterInRenderWorld.z)
        );
        this.sidePlanes.set(
            CubeFace.Right,
            new Plane(new Vector3(0, 0, -1), this.distanceFromCubeCenterInRenderWorld.z)
        );

        this.sideParent = new Object3D();
        scene.add(this.sideParent);

        this.sideMaterial = new LineBasicMaterial({
            linewidth: 1,
            color: 'black',
            transparent: true,
            opacity: transparency,
        });

        for (const face of [CubeFace.Top, CubeFace.Bottom, CubeFace.Left, CubeFace.Right]) {
            const lines = this.createSideLines(face);
            this.sideLines.set(face, lines);
            this.sideParent.add(lines);
        }
    }

    getSidePlanes() {
        return this.sidePlanes;
    }

    getSideMaterial() {
        return this.sideMaterial;
    }

    setColor(color: string) {
        this.sideMaterial.color.set(color);
        this.sideMaterial.needsUpdate = true;
    }

    update(
        xLeft: number,
        xRight: number,
        yTop: number,
        yBottom: number,
        worldSizeX: number,
        frontActiveLocalParent: Object3D,
        frontParent: Object3D
    ) {
        if (!frontActiveLocalParent) {
            return;
        }

        const faceChanged = [
            this.lastYTop != yTop, // top 2
            this.lastYBottom != yBottom, // bottom 3
            this.lastXLeft != xLeft, // left 4
            this.lastXRight != xRight, // right 5
        ];

        faceChanged[0] = faceChanged[0] || faceChanged[2] || faceChanged[3]; // top face is influenced by top, left, and right, but NOT bottom
        faceChanged[1] = faceChanged[1] || faceChanged[2] || faceChanged[3]; // bottom face is influenced by bottom, left, and right, but NOT top
        faceChanged[2] = faceChanged[2] || faceChanged[0] || faceChanged[1]; // left face is influenced by left, top, and bottom, but NOT right
        faceChanged[3] = faceChanged[3] || faceChanged[0] || faceChanged[1]; // right face is influenced by right, top, and bottom, but NOT left

        const refreshEverything =
            this.host.printTemplateDownloading || this.host.printTemplateJustDownloaded;
        const skipCubeOffset = this.host.printTemplateDownloading;

        const frontLineSegments = frontActiveLocalParent.children[0].children[0] as LineSegments;
        const frontLinePositions = frontLineSegments.geometry.attributes.position.array;
        const centerX = (xLeft + xRight) / 2;
        const centerY = (yTop + yBottom) / 2;
        const xLeftAdjusted = skipCubeOffset
            ? xLeft
            : centerX + (xLeft - centerX) * (1 + this.distanceFromCubeCenterOffset);
        const xRightAdjusted = skipCubeOffset
            ? xRight
            : centerX + (xRight - centerX) * (1 + this.distanceFromCubeCenterOffset);
        const yTopAdjusted = skipCubeOffset
            ? yTop
            : centerY + (yTop - centerY) * (1 + this.distanceFromCubeCenterOffset);
        const yBottomAdjusted = skipCubeOffset
            ? yBottom
            : centerY + (yBottom - centerY) * (1 + this.distanceFromCubeCenterOffset);

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
            const sideLines = this.sideLines.get(face)!;
            sideLines.visible = true;
            const intersectingSegments: Vector3[] = [];

            if (face == CubeFace.Left || face == CubeFace.Right) {
                const zCutoff = normalizeZForOverflow(face == CubeFace.Left ? maxZ : minZ);
                const filteredFrontLineIndices = (
                    frontActiveLocalParent.userData.lineSegmentMapZ as FastLineSegmentMap
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
                    frontActiveLocalParent.userData.lineSegmentMapY as FastLineSegmentMap
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
                    const y = frontParent.localToWorld(intersectingSegments[i]).y;
                    positions.setY(i * 2, y);
                    positions.setY(i * 2 + 1, y);
                }
            } else {
                for (let i = 0; i < smallerLimit; i++) {
                    const z = frontParent.localToWorld(intersectingSegments[i]).z;
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
                    this.lastYTop = yTop;
                    break;
                case CubeFace.Bottom:
                    this.lastYBottom = yBottom;
                    break;
                case CubeFace.Left:
                    this.lastXLeft = xLeft;
                    break;
                case CubeFace.Right:
                    this.lastXRight = xRight;
                    break;
            }
        }
    }

    private createSideLinePositions(face: CubeFace, lineAmount: number) {
        const y =
            face == CubeFace.Top
                ? this.distanceFromCubeCenterInRenderWorld.y
                : face == CubeFace.Bottom
                ? -this.distanceFromCubeCenterInRenderWorld.y
                : 0;
        const z =
            face == CubeFace.Left
                ? this.distanceFromCubeCenterInRenderWorld.z
                : face == CubeFace.Right
                ? -this.distanceFromCubeCenterInRenderWorld.z
                : 0;
        const positions: number[] = range(0, lineAmount * 6 - 1).map((i: number) =>
            i % 3 == 0
                ? Math.floor(i / 3) % 2 == 0
                    ? -this.distanceFromCubeCenterInRenderWorld.x
                    : this.distanceFromCubeCenterInRenderWorld.x
                : i % 3 == 1
                ? y
                : z
        );
        return positions;
    }

    private createSideLines(face: CubeFace) {
        const indices: number[] = [0, 1];
        const positions = this.createSideLinePositions(face, this.sideLinesInitialPoolAmount);
        const geometry = new BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();

        const lineSegments = new LineSegments(geometry, this.sideMaterial);
        lineSegments.visible = false;
        return lineSegments;
    }
}
