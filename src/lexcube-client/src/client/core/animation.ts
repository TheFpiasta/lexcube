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
 * Animation state machine extracted from interaction.ts
 *
 * This module contains:
 * - AnimationParameters: Animation state, timing calculations, and frame management
 */

import { clamp } from 'three/src/math/MathUtils';
import { Dimension, roundToSparsity, roundUpToSparsity, roundDownToSparsity } from '../constants';
import { CubeDimension, CubeDimensions, ParameterRange } from './dimensions';

export class AnimationParameters {
    private parameterRange: ParameterRange;
    private selectedRange: ParameterRange;
    private useSelectedRange: boolean;
    private cubeDimension: CubeDimension;

    // 3 parameters that can be changed in the UI
    private visibleWindow: number;
    private incrementPerStep: number;
    private fps: number;

    // 2 variables that result from the UI-set parameters
    private totalSteps!: number;
    private totalDurationSeconds!: number;

    private currentStep: number = 0;

    private sparsity: number;

    private updateAnimationDurationLabel: () => void = () => {};

    constructor(dimension: Dimension, cubeDimensions: CubeDimensions, sparsity: number, updateAnimationDurationLabel: () => void) {
        this.sparsity = sparsity;
        this.parameterRange = cubeDimensions.getParameterRangeByDimension(dimension);
        this.cubeDimension = cubeDimensions.getCubeDimensionByDimension(dimension);
        this.selectedRange = new ParameterRange();
        this.useSelectedRange = false;
        this.updateAnimationDurationLabel = updateAnimationDurationLabel;

        this.visibleWindow = NaN;
        this.incrementPerStep = NaN;
        this.fps = 10;
    }

    initialize() {
        this.setInitialValues();
    }

    updateDimension(dimension: Dimension, cubeDimensions: CubeDimensions) {
        this.cubeDimension = cubeDimensions.getCubeDimensionByDimension(dimension);
        this.parameterRange = cubeDimensions.getParameterRangeByDimension(dimension);
        this.selectedRange = new ParameterRange();
        this.useSelectedRange = false;
        this.setInitialValues();
    }

    private setInitialValues() {
        const dimensionLength = this.getRange().length();
        const targetSteps = dimensionLength / this.sparsity;
        this.visibleWindow = roundToSparsity(dimensionLength / 5.0, this.sparsity);
        this.incrementPerStep = Math.max(roundToSparsity((dimensionLength - this.visibleWindow) / targetSteps, this.sparsity), this.sparsity);
        this.updateStepsAndDuration();
    }

    private migrateValuesToNewRange() {
        this.visibleWindow = clamp(this.visibleWindow, this.getRangeForVisibleWindow()[0], this.getRangeForVisibleWindow()[1]);
        this.incrementPerStep = clamp(this.incrementPerStep, this.getRangeForIncrementPerStep()[0], this.getRangeForIncrementPerStep()[1]);
        this.updateStepsAndDuration();
    }

    private updateStepsAndDuration() {
        this.totalSteps = Math.ceil((this.getRange().length() - this.visibleWindow) / this.incrementPerStep);
        this.totalDurationSeconds = this.totalSteps / this.fps;
        this.updateAnimationDurationLabel();
    }

    indexDifferenceToString(indexDifference: number) {
        const diff = Math.round(Math.abs(indexDifference));
        const difference = this.cubeDimension.getDifferenceString(diff);
        if (!difference.differenceString) {
            const d = diff.toFixed(0);
            return `${d} unit${d == "1" ? "" : "s"}`;
        }
        const caPrefix = !difference.isExact ? "ca. " : "";
        return `${caPrefix}${difference.differenceString} (${Math.round(diff).toFixed(0)} step${diff > 1 ? "s" : ""})`;
    }

    getRangeForVisibleWindow() {
        return [this.sparsity, Math.max(this.sparsity, roundToSparsity(this.getRange().length() / 2.0, this.sparsity))];
    }

    getRangeForIncrementPerStep() { // has to be multiple of sparsity
        return [this.sparsity, Math.max(this.sparsity, roundToSparsity(this.getRange().length() / 10.0, this.sparsity))];
    }

    getExponentialRangeFromLinearRange(range: number[]) {
        const l = range[1] - range[0];
        const outputRange = [
            range[0],
            roundToSparsity(0.07 * l + range[0], this.sparsity),
            roundToSparsity(0.21 * l + range[0], this.sparsity),
            roundToSparsity(0.48 * l + range[0], this.sparsity),
            range[1]
        ];
        return outputRange;
    }

    getRangeForFps() {
        return [2, 30];
    }

    getTotalSteps() {
        return this.totalSteps;
    }

    getFps() {
        return this.fps;
    }

    getVisibleWindow() {
        return this.visibleWindow;
    }

    getDimension(): Dimension {
        return this.cubeDimension.dimension;
    }

    getIncrementPerStep() {
        return this.incrementPerStep;
    }

    setVisibleWindow(visibleWindow: number) {
        if (isNaN(visibleWindow)) {
            return;
        }
        this.visibleWindow = roundToSparsity(visibleWindow, this.sparsity);
        this.updateStepsAndDuration();
    }

    setIncrementPerStep(incrementPerStep: number) {
        if (isNaN(incrementPerStep)) {
            return;
        }
        const newIncrementPerStep = roundToSparsity(incrementPerStep, this.sparsity);
        const r = this.incrementPerStep / newIncrementPerStep;
        this.currentStep = Math.round(this.currentStep * r);
        this.incrementPerStep = newIncrementPerStep;
        this.updateStepsAndDuration();
    }

    setFps(fps: number) {
        if (isNaN(fps)) {
            return;
        }
        this.fps = fps;
        this.updateStepsAndDuration();
    }

    getFormattedDurationInSeconds() {
        return this.totalDurationSeconds.toFixed(1);
    }

    private getRange() {
        return this.useSelectedRange ? this.selectedRange : this.parameterRange;
    }

    getAnimationRangeFromStep() {
        const range = this.getRange();
        const a = this.incrementPerStep * this.currentStep;
        const min = roundUpToSparsity(Math.min(range.min + a, range.max - this.visibleWindow - 1), this.sparsity);
        const max = roundDownToSparsity(min + this.visibleWindow, this.sparsity);
        return { min, max };
    }

    increaseStep() {
        if (this.currentStep >= this.totalSteps) {
            return false;
        }
        this.currentStep += 1;
        return true;
    }

    resetStep() {
        this.currentStep = -1;
    }

    updateSelectedRange(range: ParameterRange) {
        this.selectedRange = range.clone();
        if (this.useSelectedRange) {
            this.migrateValuesToNewRange();
        }
    }

    setUseSelectedRange(useSelectedRange: boolean) {
        this.useSelectedRange = useSelectedRange;
        this.migrateValuesToNewRange();
    }
}
