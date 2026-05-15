/**
 * Selection logic extracted from interaction.ts
 *
 * This module contains:
 * - SelectionState: Simple state object for initial selection configuration
 * - CubeSelection: Selection bounds management, face visibility, and coordinate calculations
 */

import { IUniform, Vector2, Vector3 } from 'three';
import { CubeFace, Dimension, positiveModulo } from '../constants';
import { CubeTag, ParameterRange } from './dimensions';
import type { CubeClientContext } from '../client';

export class SelectionState {
    cubeId: string | undefined;
    parameterId: string | undefined;
    zRange: number[] | undefined;
    yRange: number[] | undefined;
    xRange: number[] | undefined;
}

export class CubeSelection {
    // Vector View
    private displaySizes2d: Vector2[]; // displaySizes are a multiple of sparsity + 1
    private displayOffsets2d: Vector2[]; // displayOffsets are a multiple of sparsity

    private displaySize3d: Vector3;
    private displayOffset3d: Vector3;

    // Range View
    private xSelectionRange: ParameterRange;
    private ySelectionRange: ParameterRange;
    private zSelectionRange: ParameterRange;
    private context: CubeClientContext;

    constructor(context: CubeClientContext) {
        this.context = context;
        this.displaySizes2d = [];
        this.displayOffsets2d = [];
        this.displaySize3d = new Vector3();
        this.displayOffset3d = new Vector3();
        const dims = this.context.interaction.cubeDimensions;
        const is = this.context.interaction.initialSelectionState;
        this.xSelectionRange = dims.xParameterRange.clone();
        this.ySelectionRange = dims.yParameterRange.clone();
        if (!context.widgetMode) {
            if (context.interaction.XYdataAspectRatio > 1.0) {
                this.xSelectionRange = new ParameterRange(0, Math.min(context.interaction.roundDownToSparsity(dims.xParameterRange.max / context.interaction.XYdataAspectRatio), dims.xParameterRange.max - 1) + 1, true);
            } else {
                this.ySelectionRange = new ParameterRange(0, Math.min(context.interaction.roundDownToSparsity(dims.yParameterRange.max * context.interaction.XYdataAspectRatio), dims.yParameterRange.max - 1) + 1, true);
            }
        } else {
            this.xSelectionRange = dims.xParameterRange.clone();
        }
        if (context.interaction.cubeTags.includes(CubeTag.ESDC)) {
            const l = this.xSelectionRange.length() - 1; // -1 to get identical views as before range refactor
            const offset = this.context.interaction.roundUpToSparsity(l * 0.83);
            this.xSelectionRange.set(offset, this.context.interaction.roundDownToSparsity(offset + l - 1) + 1);
        }
        if (context.interaction.cubeTags.includes(CubeTag.CamsEac4Reanalysis) || context.interaction.cubeTags.includes(CubeTag.Era5SpecificHumidity) || (context.interaction.cubeTags.includes(CubeTag.LongitudeZeroIndexIsGreenwich) && context.interaction.cubeTags.includes(CubeTag.Global))) {
            const l = this.xSelectionRange.length() - 3; // -1 to get identical views as before range refactor
            const offset = this.context.interaction.roundUpToSparsity(l * 1.834);
            this.xSelectionRange.set(offset, this.context.interaction.roundDownToSparsity(offset + l - 1) + 1);
        }
        this.zSelectionRange = dims.zParameterRange.clone();
        if (context.interaction.cubeTags.includes(CubeTag.ESDC)) {
            this.zSelectionRange.max = context.interaction.roundDownToSparsity(this.zSelectionRange.max - 6) + 1;
        }

        if (this.context.interaction.initialLoad) {
            this.parseInitialRange(is.xRange, dims.xParameterRange, this.xSelectionRange, Dimension.X);
            this.parseInitialRange(is.yRange, dims.yParameterRange, this.ySelectionRange, Dimension.Y);
            this.parseInitialRange(is.zRange, dims.zParameterRange, this.zSelectionRange, Dimension.Z);
        }

        for (let face = 0; face < 3; face++) {
            this.displaySizes2d.push(new Vector2());
            this.displayOffsets2d.push(new Vector2());
        }

        // here, all selection ranges need to be a multiple of sparsity + 1 in size
        for (const dim of [Dimension.X, Dimension.Y, Dimension.Z]) {
            const selectionRange = this.getSelectionRangeByDimension(dim);
            if (selectionRange.length() % ParameterRange.sparsity != 1 && ParameterRange.sparsity > 1) {
                console.error(`Invalid selection range ${selectionRange} for dimension ${Dimension[dim]} at initialization`);
            }
        }

        this.updateAllVectors();
    }

    private parseInitialRange(parsedRange: number[] | undefined, parameterRange: ParameterRange, selectionRange: ParameterRange, dimension: Dimension) {
        if (!parsedRange) {
            return;
        }
        const s = new ParameterRange(this.context.interaction.roundUpToSparsity(parsedRange[0]), this.context.interaction.roundDownToSparsity(parsedRange[1]) + 1);
        if (s.length() > 0 && s.subRangeOf(parameterRange, this.context.rendering.dimensionOverflow[dimension])) {
            selectionRange.copy(s);
            this.context.log("Parsed initial selection range", s);
        }
    }

    parseSelectionBoundariesFromWidget(xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number) {
        const changed = [
            this.parseSelectionBoundary(xMin, xMax, Dimension.X),
            this.parseSelectionBoundary(yMin, yMax, Dimension.Y),
            this.parseSelectionBoundary(zMin, zMax, Dimension.Z)
        ].some((x) => x === true);
        if (changed) {
            this.updateAllVectors();
            this.context.rendering.updateVisibilityAndLodsDebounced();
            this.updateSelectionRelevantUi();
        }
    }

    parseSelectionBoundary(parsedLowerBoundary: number | undefined, parsedUpperBoundary: number | undefined, dimension: Dimension) {
        if (typeof (parsedLowerBoundary) != "number" || isNaN(parsedLowerBoundary) || parsedLowerBoundary < 0 ||
            typeof (parsedUpperBoundary) != "number" || isNaN(parsedUpperBoundary) || parsedUpperBoundary < 0) {
            return false;
        }
        const selectionRange = this.getSelectionRangeByDimension(dimension);
        if (parsedLowerBoundary === undefined) {
            parsedLowerBoundary = selectionRange.min;
        }
        if (parsedUpperBoundary === undefined) {
            parsedUpperBoundary = selectionRange.max;
        }
        const attemptedRange = new ParameterRange(parsedLowerBoundary, parsedUpperBoundary);
        if (attemptedRange.equals(selectionRange)) {
            return false;
        }
        const parameterRange = this.context.interaction.cubeDimensions.getParameterRangeByDimension(dimension);
        if (attemptedRange.length() >= 1 && attemptedRange.subRangeOf(parameterRange, this.context.rendering.dimensionOverflow[dimension])) {
            selectionRange.copy(attemptedRange);
            return true;
        } else {
            throw new Error(`Invalid selection boundary ${attemptedRange} for dimension ${Dimension[dimension]} (Valid parameter range is ${parameterRange})`);
        }
    }

    private roundVectorToSparsity(vector: Vector2, minX: number, maxX: number, minY: number, maxY: number) {
        // if ((minX + maxX + minY + maxY) % 10 != 0) {
        //     console.warn(`Bad values in roundtoSparsity,vector ${vector},minX ${minX},maxX ${maxX},minY ${minY},maxY ${maxY}`)
        // }
        const int = this.context.interaction;
        const newVector = vector.clone();
        newVector.x = Math.max(int.roundUpToSparsity(minX), int.roundToSparsity(vector.x));
        if (newVector.x >= maxX) {
            newVector.x = int.roundDownToSparsity(maxX);
        }
        newVector.y = Math.max(int.roundUpToSparsity(minY), int.roundToSparsity(vector.y));
        if (newVector.y >= maxY) {
            newVector.y = int.roundDownToSparsity(maxY);
        }
        return newVector;
    }

    private roundSizeToSparsity(size: Vector2, face: CubeFace) {
        const maxX = this.context.interaction.cubeDimensions.totalWidthForFace(face); // overflow not currently considered here, since this is called from ranges/sliders only
        const maxY = this.context.interaction.cubeDimensions.totalHeightForFace(face);
        const v = this.roundVectorToSparsity(size.clone().subScalar(1), 0, maxX, 0, maxY).addScalar(1);
        return v;
    }

    private roundOffsetToSparsity(offset: Vector2, face: CubeFace) {
        const min = this.context.interaction.getMinimumDisplayOffset(face)
        const max = this.context.interaction.getMaximumDisplayOffset(face, this.displaySizes2d[Math.floor(face / 2)])
        if (this.context.rendering.dimensionOverflow[Dimension.X] && (face == CubeFace.Front || face == CubeFace.Back || face == CubeFace.Top || face == CubeFace.Bottom)) {
            return this.roundVectorToSparsity(offset, -Infinity, Infinity, min.y, max.y);
        }
        return this.roundVectorToSparsity(offset, min.x, max.x, min.y, max.y);
    }

    setUniformLocations2d(face: number, size: IUniform<Vector2>, offset: IUniform<Vector2>) {
        size.value = this.displaySizes2d[Math.floor(face / 2)];
        offset.value = this.displayOffsets2d[Math.floor(face / 2)];
    }

    setUniformLocations3d(size: IUniform<Vector3>, offset: IUniform<Vector3>) {
        size.value = this.displaySize3d;
        offset.value = this.displayOffset3d;
    }

    getDisplaySizeVector2d(face: CubeFace) {
        return this.displaySizes2d[Math.floor(face / 2)];
    }

    getDisplaySizeVector3d() {
        return this.displaySize3d;
    }

    getDisplayOffsetVector2d(face: CubeFace) {
        return this.displayOffsets2d[Math.floor(face / 2)];
    }

    getDisplayOffsetVector3d() {
        return this.displayOffset3d;
    }

    setVectorsNoRounding(face: CubeFace, size: Vector2, offset: Vector2) {
        this.displaySizes2d[Math.floor(face / 2)].copy(size);
        this.displayOffsets2d[Math.floor(face / 2)].copy(offset);
        this.updateAfterVectorChange(face, false);
    }

    setVectors(face: CubeFace, size: Vector2, offset: Vector2) {
        if (size.length() > 0) {
            this.displaySizes2d[Math.floor(face / 2)].copy(this.roundSizeToSparsity(size, face));
        }
        this.displayOffsets2d[Math.floor(face / 2)].copy(this.roundOffsetToSparsity(offset, face));
        this.updateAfterVectorChange(face, true);
    }

    fixAllVectorsToSparsity() {
        for (let i = 0; i < 3; i++) {
            const ts = this.roundSizeToSparsity(this.displaySizes2d[i], i);
            const to = this.roundOffsetToSparsity(this.displayOffsets2d[i], i);
            if (!ts.equals(this.displaySizes2d[i])) {
                console.warn("Fixing size vector", i, "currently", this.displaySizes2d[i], "now", ts);
                this.displaySizes2d[i].copy(ts);
            }
            if (!to.equals(this.displayOffsets2d[i])) {
                console.warn("Fixing offset vector", i, "currently", this.displayOffsets2d[i], "now", to);
                this.displayOffsets2d[i].copy(to);
            }
        }
    }

    setOffsetVectorNoRounding(face: CubeFace, newOffset: Vector2) {
        this.displayOffsets2d[Math.floor(face / 2)].copy(newOffset);
        this.updateAfterVectorChange(face, false);
    }

    setOffsetVector(face: CubeFace, newOffset: Vector2) {
        this.displayOffsets2d[Math.floor(face / 2)].copy(this.roundOffsetToSparsity(newOffset, face));
        this.updateAfterVectorChange(face, true);
    }

    private updateAfterVectorChange(face: CubeFace, finalChange: boolean) {
        this.updateRanges(face, finalChange);
        this.updateOtherVectors(face);
        this.updateSelectionRelevantUi(finalChange, true);
        if (this.context.orchestrationMinionMode || this.context.orchestrationMasterMode) {
            this.context.networking.pushOrchestratorSelectionUpdate(this.displayOffsets2d, this.displaySizes2d, finalChange);
        }
    }

    applyVectorsFromOrchestrator(displayOffsets: Vector2[], displaySizes: Vector2[], finalChange: boolean) {
        if (finalChange) {
            const roundedDisplaySizes = displaySizes.map((v, i) => this.roundSizeToSparsity(v, i*2));
            const roundedDisplayOffsets = displayOffsets.map((v, i) => this.roundOffsetToSparsity(v, i*2));
            for (let i = 0; i < 3; i++) {
                if (!roundedDisplaySizes[i].equals(displaySizes[i]) || !roundedDisplayOffsets[i].equals(displayOffsets[i])) {
                    console.warn("Final Vectors from orchestrator not rounded to sparsity, emergency rounding. ", roundedDisplaySizes[i], roundedDisplayOffsets[i]);
                }
                displaySizes[i].copy(roundedDisplaySizes[i]);
                displayOffsets[i].copy(roundedDisplayOffsets[i]);
            }
        }

        for (let i = 0; i < 3; i++) {
            this.displayOffsets2d[i].copy(displayOffsets[i]);
            this.displaySizes2d[i].copy(displaySizes[i]);
        }

        for (let i = 0; i < 3; i++) {
            this.updateRanges(i*2, finalChange);
        }
        if (finalChange) {
            this.context.rendering.updateVisibilityAndLods();
        }
        this.context.rendering.updateRegionBorderPositionAndResolution();
        this.context.rendering.requestRender();
    }

    updateSelectionRelevantUi(finalChange: boolean = true, updateSliders: boolean = true, affectedDimensions: Dimension[] | undefined = undefined) {
        this.context.interaction.updateSlidersAndLabelsAfterChange(updateSliders, affectedDimensions);
        this.context.rendering.updateRegionBorderPositionAndResolution();
        this.context.interaction.updateTimeSeriesSelectionBounds();
        if (finalChange) {
            this.context.interaction.requestUrlFragmentUpdate();
            this.context.interaction.updateAnimationSelectedRangeOnlyLabel();
        }
        if (this.context.widgetMode && finalChange) {
            this.context.interaction.updateWidgetModelRanges();
        }
    }

    // Used by sliders and animation step
    setRange(dimension: Dimension, min: number, max: number) {
        const range = this.getSelectionRangeByDimension(dimension);
        range.set(this.context.interaction.roundToSparsity(min), this.context.interaction.roundToSparsity(max) + 1);
        this.updateAllVectors();
        if (this.context.orchestrationMinionMode || this.context.orchestrationMasterMode) {
            this.context.networking.pushOrchestratorSelectionUpdate(this.displayOffsets2d, this.displaySizes2d, true);
        }
    }

    private updateVectors2d(face: CubeFace) {
        const xRange = this.xSelectionRangeForFace(face);
        const yRange = this.ySelectionRangeForFace(face);
        this.displaySizes2d[Math.floor(face / 2)].set(xRange.length(), yRange.length());
        this.displayOffsets2d[Math.floor(face / 2)].set(xRange.min, yRange.min);
    }

    private updateVectors3d() {
        this.displaySize3d.set(this.xSelectionRange.length(), this.ySelectionRange.length(), this.zSelectionRange.length());
        this.displayOffset3d.set(this.xSelectionRange.min, this.ySelectionRange.min, this.zSelectionRange.min);
    }

    private updateRanges(face: CubeFace, finalChange: boolean) {
        this.xSelectionRangeForFace(face).set(this.displayOffsets2d[Math.floor(face / 2)].x, this.displayOffsets2d[Math.floor(face / 2)].x + this.displaySizes2d[Math.floor(face / 2)].x, finalChange, this.displaySizes2d[Math.floor(face / 2)].x);
        this.ySelectionRangeForFace(face).set(this.displayOffsets2d[Math.floor(face / 2)].y, this.displayOffsets2d[Math.floor(face / 2)].y + this.displaySizes2d[Math.floor(face / 2)].y, finalChange, this.displaySizes2d[Math.floor(face / 2)].y);
    }

    private updateAllVectors() {
        for (let i = 0; i < 6; i++) {
            this.updateVectors2d(i)
        }
        this.updateVectors3d();
        this.context.rendering.requestRender();
    }

    private updateOtherVectors(face: CubeFace) {
        for (let i = 0; i < 6; i++) {
            if (i != face) {
                this.updateVectors2d(i)
            }
        }
        this.updateVectors3d();
        this.context.rendering.requestRender();
    }

    private xSelectionRangeForFace(face: CubeFace) {
        if (face <= 1) {
            // front/back
            return this.xSelectionRange;
        } else if (face <= 3) {
            // top/bottom
            return this.xSelectionRange;
        } else {
            // left/right
            return this.ySelectionRange;
        }
    }

    private ySelectionRangeForFace(face: CubeFace) {
        if (face <= 1) {
            // front/back
            return this.ySelectionRange;
        } else if (face <= 3) {
            // top/bottom
            return this.zSelectionRange;
        } else {
            // left/right
            return this.zSelectionRange;
        }
    }

    getGuaranteedSparsityValidIndexValueForFace(face: CubeFace): number {
        const candidate = this.getIndexValueForFace(face);
        const roundedCandidate = this.context.interaction.roundToSparsity(candidate);
        if (roundedCandidate != candidate) {
            console.warn(`(!!!) Index value for face ${CubeFace[face]} (${candidate}) not rounded to sparsity ${ParameterRange.sparsity}, emergency rounding to ${roundedCandidate}`);
            return roundedCandidate;
        }
        return candidate;
    }

    getIndexValueForFace(face: CubeFace): number {
        if (face == CubeFace.Front) {
            return this.zSelectionRange.max - 1;
        } else if (face == CubeFace.Back) {
            return this.zSelectionRange.min;
        } else if (face == CubeFace.Top) {
            return this.ySelectionRange.min;
        } else if (face == CubeFace.Bottom) {
            return this.ySelectionRange.max - 1;
        } else if (face == CubeFace.Left) {
            return positiveModulo(this.xSelectionRange.min, this.context.interaction.cubeDimensions.x.steps);
        } else {
            return positiveModulo(this.xSelectionRange.max - 1, this.context.interaction.cubeDimensions.x.steps);
        }
    }

    getSelectionRangeByDimension(dimension: Dimension): ParameterRange {
        if (dimension == Dimension.Z) {
            return this.zSelectionRange;
        } else if (dimension == Dimension.Y) {
            return this.ySelectionRange;
        } else {
            return this.xSelectionRange;
        }
    }
}
