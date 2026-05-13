import { clamp } from 'three/src/math/MathUtils';
import noUiSlider, { API, PartialFormatter } from 'nouislider';
import { Dimension, CubeFace, positiveModulo, roundDownToSparsity, roundUpToSparsity, NON_EXTREME_QUANTILE_INDEX, QUANTILE_STEP } from '../constants';
import { CubeTag } from '../core/dimensions';
import { CubeDimensions, ParameterRange } from '../core/dimensions';
import { CubeSelection } from '../core/selection';
import { AnimationParameters } from '../core/animation';


interface SliderUIHostState {
    get updateUiDuringInteractionsSliders(): boolean;
    get cubeDimensions(): CubeDimensions;
    get cubeSelection(): CubeSelection;
    get sparsity(): number;
    get geospatialContextProvided(): boolean;
    get cubeTags(): CubeTag[];
    get animationParameters(): AnimationParameters;
    log(...args: any[]): void;
    onSelectionRangeChanged(dimension: Dimension, min: number, max: number): void;
    onSelectionUiUpdate(downloadTiles: boolean, force: boolean): void;
    onVisibilityAndLodUpdate(): void;
    onVolumeAbsoluteThresholdChanged(value: number, updateUi: boolean): void;
    onVolumeQuantileThresholdChanged(value: number, updateUi: boolean): void;
    onVolumeRangeChanged(min: number | null, max: number | null, updateUi: boolean): void;
    onVolumeUseQuantileChanged(useQuantile: boolean): void;
    getVolumeRenderingThresholdSign(): number;
    setVolumeRenderingThresholdSign(thresholdSign: number, updateUi: boolean): void;
    toFixed: (f: number) => string;
    getUnitHTML: () => string;
}


class SliderUIManager {
    private host: SliderUIHostState;
    private htmlParent: HTMLElement;

    // Slider instances
    zSelectionSlider!: API;
    ySelectionSlider!: API;
    xSelectionSlider!: API;
    volumeVizThresholdSlider!: API;
    volumeVizRangeSlider!: API;
    volumeVizQuantileSlider!: API;
    animationIncrementSlider!: API;
    animationWindowSlider!: API;
    animationSpeedSlider!: API;

    // HTML elements
    private zSliderDiv!: HTMLElement;
    private ySliderDiv!: HTMLElement;
    private xSliderDiv!: HTMLElement;
    private zSliderLabelDiv!: HTMLElement;
    private ySliderLabelDiv!: HTMLElement;
    private xSliderLabelDiv!: HTMLElement;
    private volumeVizQuantileSliderDiv!: HTMLElement;
    // private volumeVizQuantileSliderLabelDiv!: HTMLElement;
    private volumeVizThresholdSliderDiv!: HTMLElement;
    // volumeVizThresholdSliderLabelDiv!: HTMLElement;
    private volumeVizRangeSliderDiv!: HTMLElement;
    private htmlAnimationIncrementSliderDiv!: HTMLElement;
    private htmlAnimationWindowSliderDiv!: HTMLElement;
    private htmlAnimationSpeedSliderDiv!: HTMLElement;
    private htmlAnimationTotalDurationDiv!: HTMLElement;

    private htmlVolumeVizThresholdSliderSignsDiv!: HTMLElement;

    private htmlVolumeVizThresholdSliderSignLessThan!: HTMLElement;
    private htmlVolumeVizThresholdSliderSignInterval!: HTMLElement;
    private htmlVolumeVizThresholdSliderSignGreaterThan!: HTMLElement;

    private lastOverflowXSliderIndex = 0;
    private volumeVizQuantileSliderConnects: HTMLElement[] = [];
    private volumeVizQuantileSliderConnectIsLowerActive: boolean = false;

    constructor(host: SliderUIHostState, htmlParent: HTMLElement) {
        this.host = host;
        this.htmlParent = htmlParent;
    }

    setupHtmlReferences() {
        const getByClass = (className: string) => {
            const elements = this.htmlParent.getElementsByClassName(className);
            if (elements.length != 1) {
                console.warn("Tried to access HTML element of class name", className, "but got", elements.length, "results.")
            }
            return elements[0] as HTMLElement;
        };

        this.zSliderDiv = getByClass('z-selection-slider');
        this.ySliderDiv = getByClass('y-selection-slider');
        this.xSliderDiv = getByClass('x-selection-slider');
        this.zSliderLabelDiv = getByClass('z-selection-slider-label');
        this.ySliderLabelDiv = getByClass('y-selection-slider-label');
        this.xSliderLabelDiv = getByClass('x-selection-slider-label');
        this.volumeVizThresholdSliderDiv = getByClass('volume-viz-threshold-slider');

        this.htmlVolumeVizThresholdSliderSignsDiv = getByClass('volume-viz-threshold-slider-signs');
        this.htmlVolumeVizThresholdSliderSignLessThan = getByClass('volume-viz-threshold-slider-sign-less-than');
        this.htmlVolumeVizThresholdSliderSignInterval = getByClass('volume-viz-threshold-slider-sign-interval');
        this.htmlVolumeVizThresholdSliderSignGreaterThan = getByClass('volume-viz-threshold-slider-sign-greater-than');
        // this.volumeVizThresholdSliderLabelDiv = getByClass('volume-viz-threshold-slider-label');
        this.volumeVizQuantileSliderDiv = getByClass('volume-viz-quantile-slider');
        // this.volumeVizQuantileSliderLabelDiv = getByClass('volume-viz-quantile-slider-label');
        this.volumeVizRangeSliderDiv = getByClass('volume-viz-range-slider');
        this.htmlAnimationIncrementSliderDiv = getByClass('animation-increment-slider');
        this.htmlAnimationWindowSliderDiv = getByClass('animation-window-slider');
        this.htmlAnimationSpeedSliderDiv = getByClass('animation-speed-slider');
        this.htmlAnimationTotalDurationDiv = getByClass('animation-total-duration');

        this.htmlVolumeVizThresholdSliderSignsDiv.onclick = () => {
            this.selectNextSign();
        }
    }

    migrateSliderValues(previousSign: number, newSign: number) {
        if (newSign == 0) {
            const currentThreshold = parseFloat(this.volumeVizThresholdSlider.get() as string);
            const thresholdMin = this.volumeVizThresholdSlider.options.range.min as number;
            const thresholdMax = this.volumeVizThresholdSlider.options.range.max as number;
            const thresholdBreakPointForLeftRightDecision = thresholdMin + (thresholdMax - thresholdMin) * 0.74;
            const minIsCloser = currentThreshold < thresholdBreakPointForLeftRightDecision;
            const distanceToBounds = minIsCloser ? currentThreshold - thresholdMin : thresholdMax - currentThreshold;
            const distance = Math.min(distanceToBounds, 0.25 * (thresholdMax - thresholdMin));
            const lower = minIsCloser ? currentThreshold : Math.max(currentThreshold - distance, thresholdMin);
            const upper = !minIsCloser ? currentThreshold : Math.min(currentThreshold + distance, thresholdMax);
            this.rangeSlideHappened = [true, true];
            this.volumeVizRangeSlider.set([lower, upper]);
        } else if (newSign == 1 && previousSign == 0) {
            const currentRange = this.volumeVizRangeSlider.get() as string[];
            const newThreshold = parseFloat(currentRange[0]);
            this.thresholdSlideHappened = true;
            this.volumeVizThresholdSlider.set(newThreshold);
        }
    }

    updateSlidersVisibility(useQuantile: boolean) {
        this.volumeVizQuantileSliderDiv.parentElement!.style.display = useQuantile ? "block" : "none";
        this.volumeVizThresholdSliderDiv.parentElement!.style.display = (!useQuantile && this.host.getVolumeRenderingThresholdSign() != 0) ? "block" : "none";
        this.volumeVizRangeSliderDiv.parentElement!.style.display = (!useQuantile && this.host.getVolumeRenderingThresholdSign() == 0) ? "block" : "none";

        if (useQuantile) { // when revealing quantile slider, current quantile slider value needs to set new sign
            this.updateVolumeVizSignFromQuantileSliderStatus();
        }
    }

    updateSignVisual() {
        const sign = this.host.getVolumeRenderingThresholdSign();

        this.htmlVolumeVizThresholdSliderSignLessThan.style.opacity = sign < 0 ? "1" : "0.3";
        this.htmlVolumeVizThresholdSliderSignInterval.style.opacity = sign == 0 ? "1" : "0.3";
        this.htmlVolumeVizThresholdSliderSignGreaterThan.style.opacity = sign > 0 ? "1" : "0.3";
    }

    toggleThresholdSliderAnimations(animate: boolean) {
        this.volumeVizThresholdSlider.updateOptions( { animate: animate }, false);
    }

    prepareAll() {
        this.setupRangeSliders();
        this.prepareAnimationSliders();

        const allSliders = this.htmlParent.getElementsByClassName("noUi-connect");
        for (let s of allSliders) {
            (s as any).style.background = "#36082a";
        }
    }

    private prepareSelectionRangeSlider(div: HTMLElement, intermediateAndFinalUpdate: (arr: string[]) => void, finalUpdate: () => void, formatter?: PartialFormatter): API {
        let slider = noUiSlider.create(div, {
            start: [20, 30],
            connect: true,
            step: 1,
            tooltips: formatter || true,
            behaviour: 'drag',
            range: {
                'min': 0,
                'max': 100
            }
        });
        (slider as any).formatter = formatter;

        if (this.host.updateUiDuringInteractionsSliders) {
            slider.on("slide", finalUpdate as any);
        }
        slider.on("slide", intermediateAndFinalUpdate as any);
        slider.on("set", finalUpdate as any);
        slider.on("set", intermediateAndFinalUpdate as any);
        return slider;
    }

    private prepareVolumeVizQuantileSlider(div: HTMLElement): API {
        let slider = noUiSlider.create(div, {
            start: [0],
            connect: [true, true],
            step: 1,
            tooltips: true,
            behaviour: 'drag',
            range: {
                'min': [0, 1],
                '40%': [NON_EXTREME_QUANTILE_INDEX - 1, 2],
                '60%': [NON_EXTREME_QUANTILE_INDEX + 1, 1],
                'max': [NON_EXTREME_QUANTILE_INDEX * 2, 1]
            }
        });
        const formatter = {
            to: (value: number) => {
                value = Math.round(value);
                let quantile = 0.5;
                let prefix = "";
                if (value < NON_EXTREME_QUANTILE_INDEX) {
                    quantile = (value + 1) * QUANTILE_STEP;
                    prefix = "≤";
                } else if (value > NON_EXTREME_QUANTILE_INDEX) {
                    quantile = 1.0 - (NON_EXTREME_QUANTILE_INDEX * 2 + 1 - value) * QUANTILE_STEP;
                    prefix = "≥";
                } else {
                    return `No threshold`;
                }
                return `${prefix}${(quantile * 100).toFixed(0)}%`;
            },
        };
        slider.updateOptions({ tooltips: formatter }, false);

        this.volumeVizQuantileSliderConnects = [div.getElementsByClassName("noUi-connect")[0] as HTMLElement, div.getElementsByClassName("noUi-connect")[1] as HTMLElement];
        this.updateVolumeVizQuantileSliderSignAndConnects(0);

        const updateQuantile = (newRange: string[]) => {
            const v = Math.round(parseFloat(newRange[0]));
            this.host.onVolumeQuantileThresholdChanged(v, false);
            // this.host.onVolumeUseQuantileChanged(true); 
            this.updateVolumeVizQuantileSliderSignAndConnects(v);
        };

        slider.on("slide", updateQuantile as any);
        slider.on("set", updateQuantile as any);
        return slider;
    }

    private thresholdSlideHappened = false;

    private thresholdSignChangeCooldown = 100;
    private lastThresholdSignChangeTime = 0;

    private prepareVolumeVizThresholdSlider(div: HTMLElement): API {
        const formatter = {
            to: (value: number) => {
                const unit = this.host.getUnitHTML();
                const prefix = this.host.getVolumeRenderingThresholdSign() >= 0 ? "≥" : (this.host.getVolumeRenderingThresholdSign() <= 0 ? "≤" : "=");
                return `${prefix}${this.host.toFixed(value)}${unit}`;
            },
        };

        let slider = noUiSlider.create(div, {
            start: 0,
            connect: [true, true],
            step: 0.1,
            tooltips: formatter || true,
            behaviour: 'drag',
            range: {
                'min': 0,
                'max': 100
            }
        });


        const updateThreshold = (newRange: string[]) => {
            const v = parseFloat(newRange[0]);
            this.host.onVolumeAbsoluteThresholdChanged(v, false);
            this.thresholdSlideHappened = true;
        };

        const updateThresholdAndCheckForClick = (newRange: string[]) => {
            const v = parseFloat(newRange[0]);
            // if (!this.thresholdSlideHappened && Date.now() - this.lastThresholdSignChangeTime > this.thresholdSignChangeCooldown) {
            //     this.selectNextSign();
            // }
            this.host.onVolumeAbsoluteThresholdChanged(v, false);
            this.thresholdSlideHappened = false;
        };

        slider.on("slide", updateThreshold as any);
        slider.on("set", updateThresholdAndCheckForClick as any);
        return slider;
    }

    private rangeSlideHappened = [false, false];

    private prepareVolumeVizRangeSlider(div: HTMLElement): API {
        const formatterRangeLower = {
            to: (value: number) => {
                const unit = this.host.getUnitHTML();
                return `${this.host.toFixed(value)}${unit}`;
            },
        };

        const formatterRangeUpper = {
            to: (value: number) => {
                const unit = this.host.getUnitHTML();
                return `${this.host.toFixed(value)}${unit}`;
            },
        };

        let slider = noUiSlider.create(div, {
            start: [0, 1],
            connect: [false, true, false],
            step: 0.1,
            tooltips: formatterRangeLower, //[formatterRangeLower, formatterRangeUpper],
            behaviour: 'drag',
            range: {
                'min': 0,
                'max': 100
            }
        });


        const updateRange = (newRange: string[], handle: number) => {
            const v1 = parseFloat(newRange[0]);
            const v2 = parseFloat(newRange[1]);
            this.host.onVolumeRangeChanged(v1, v2, false);
            this.rangeSlideHappened[handle] = true;
        };

        const updateRangeAndCheckForClick = (newRange: string[], handle: number) => {
            const v = parseFloat(newRange[handle]);
            // if (!this.rangeSlideHappened[handle] && Date.now() - this.lastThresholdSignChangeTime > this.thresholdSignChangeCooldown) {
            //     this.selectNextSign();
            // }
            this.rangeSlideHappened[handle] = false;
            this.host.onVolumeRangeChanged(handle == 0 ? v : null, handle == 1 ? v : null, false);
        };

        slider.on("slide", updateRange as any);
        slider.on("set", updateRangeAndCheckForClick as any);
        return slider;
    }

    selectNextSign() {    
        const currentSign = this.host.getVolumeRenderingThresholdSign(); // -1, 0, or 1
        const newSign = currentSign > 0 ? -1 : (currentSign < 0 ? 0 : 1);
        this.migrateSliderValues(currentSign, newSign);
        this.host.setVolumeRenderingThresholdSign(newSign, true);
        this.volumeVizThresholdSlider.updateOptions({}, false);
        this.volumeVizQuantileSlider.updateOptions({}, false);
        this.lastThresholdSignChangeTime = Date.now();
        this.updateSignVisual();
    }


    private setupRangeSliders() {
        const intermediateZUpdate = (newRange: string[]) => {
            this.host.onSelectionRangeChanged(Dimension.Z, parseInt(newRange[0]), parseInt(newRange[1]));
            this.host.onSelectionUiUpdate(false, false);
        };
        const intermediateYUpdate = (newRange: string[]) => {
            this.host.onSelectionRangeChanged(Dimension.Y, parseInt(newRange[0]), parseInt(newRange[1]));
            this.host.onSelectionUiUpdate(false, false);
        };
        const intermediateXUpdate = (newRange: string[]) => {
            this.host.onSelectionRangeChanged(Dimension.X, parseInt(newRange[0]), parseInt(newRange[1]));
            this.host.onSelectionUiUpdate(false, false);
        };

        const finalUpdate = () => {
            this.host.onVisibilityAndLodUpdate();
            this.host.onSelectionUiUpdate(true, false);
        };

        const zFormatter = {
            to: (value: number) => {
                const dims = this.host.cubeDimensions;
                if (typeof dims === "undefined") {
                    return '';
                }
                return dims.z.getIndexString(value);
            },
        };
        const yFormatter = {
            to: (value: number) => {
                const dims = this.host.cubeDimensions;
                if (typeof dims === "undefined") {
                    return '';
                }
                return dims.y.getIndexString(value);
            },
        };
        const xFormatter = {
            to: (value: number) => {
                const dims = this.host.cubeDimensions;
                if (typeof dims === "undefined") {
                    return '';
                }
                return dims.x.getIndexString(value);
            },
        };
        this.zSelectionSlider = this.prepareSelectionRangeSlider(this.zSliderDiv, intermediateZUpdate, finalUpdate, zFormatter);
        this.ySelectionSlider = this.prepareSelectionRangeSlider(this.ySliderDiv, intermediateYUpdate, finalUpdate, yFormatter);
        this.xSelectionSlider = this.prepareSelectionRangeSlider(this.xSliderDiv, intermediateXUpdate, finalUpdate, xFormatter);

        this.volumeVizThresholdSlider = this.prepareVolumeVizThresholdSlider(this.volumeVizThresholdSliderDiv);
        this.volumeVizRangeSlider = this.prepareVolumeVizRangeSlider(this.volumeVizRangeSliderDiv);
        this.volumeVizQuantileSlider = this.prepareVolumeVizQuantileSlider(this.volumeVizQuantileSliderDiv);
    }

    private prepareAnimationSliders() {
        let basicSlider = (div: HTMLElement) => {
            return noUiSlider.create(div, {
                start: [0],
                connect: false,
                step: 1,
                tooltips: true,
                behaviour: 'drag',
                range: {
                    'min': 0,
                    'max': 100
                }
            });
        };
        this.animationIncrementSlider = basicSlider(this.htmlAnimationIncrementSliderDiv);
        this.animationWindowSlider = basicSlider(this.htmlAnimationWindowSliderDiv);
        this.animationSpeedSlider = basicSlider(this.htmlAnimationSpeedSliderDiv);

        const updateAnimationIncrement = (newRange: string[]) => {
            const v = parseInt(newRange[0]);
            this.host.animationParameters.setIncrementPerStep(v);
        };
        const windowAndIncrementFormatter = {
            to: (value: number) => {
                if (!this.host.animationParameters) {
                    return `${value}`;
                }
                return this.host.animationParameters.indexDifferenceToString(Math.abs(Math.round(value)));
            },
        };
        this.animationIncrementSlider.updateOptions({ tooltips: windowAndIncrementFormatter }, false);
        this.animationIncrementSlider.on("slide", updateAnimationIncrement as any);
        this.animationIncrementSlider.on("set", updateAnimationIncrement as any);

        const updateAnimationWindow = (newRange: string[]) => {
            const v = parseInt(newRange[0]);
            this.host.animationParameters.setVisibleWindow(v);
        };
        this.animationWindowSlider.updateOptions({ tooltips: windowAndIncrementFormatter }, false);
        this.animationWindowSlider.on("slide", updateAnimationWindow as any);
        this.animationWindowSlider.on("set", updateAnimationWindow as any);

        const updateAnimationSpeed = (newRange: string[]) => {
            const v = parseFloat(newRange[0]);
            this.host.animationParameters.setFps(v);
        };
        const speedFormatter = {
            to: (value: number) => {
                return `${Math.round(value).toFixed(0)} FPS`;
            },
        };
        this.animationSpeedSlider.updateOptions({ tooltips: speedFormatter }, false);
        this.animationSpeedSlider.on("slide", updateAnimationSpeed as any);
        this.animationSpeedSlider.on("set", updateAnimationSpeed as any);
    }

    updateDimensionSliderLabels() {
        this.zSliderLabelDiv.innerHTML = `${this.host.cubeDimensions.z.getName()}:`;
        this.ySliderLabelDiv.innerHTML = `${this.host.cubeDimensions.y.getName()}:`;
        this.xSliderLabelDiv.innerHTML = `${this.host.cubeDimensions.x.getName()}:`;
    }

    updateSelectionRangeBounds() {
        const zRange = this.host.cubeDimensions.zParameterRange;
        const yRange = this.host.cubeDimensions.yParameterRange;
        const xRange = this.host.cubeDimensions.xParameterRange;
        this.zSelectionSlider.updateOptions({ range: { min: zRange.min, max: zRange.max - 1 }, step: this.host.sparsity, margin: this.host.sparsity }, false);
        this.ySelectionSlider.updateOptions({ range: { min: yRange.min, max: yRange.max - 1 }, step: this.host.sparsity, margin: this.host.sparsity }, false);
        this.xSelectionSlider.updateOptions({ range: { min: xRange.min, max: xRange.max - 1 }, step: this.host.sparsity, margin: this.host.sparsity }, false);
        this.zSelectionSlider.off("update");
        this.ySelectionSlider.off("update");
        this.xSelectionSlider.off("update");
        this.mergeSliderTooltips(this.zSliderDiv as any, 40, " - ");
        if (this.host.geospatialContextProvided) {
            this.mergeSliderTooltips(this.ySliderDiv as any, 40, " - ");
            this.mergeSliderTooltips(this.xSliderDiv as any, 40, " - ");
        }
    }

    updateSliderValuesAfterChange(dimensionsOnly: Dimension[] = []) {
        const zSelectionRange = this.host.cubeSelection.getSelectionRangeByDimension(Dimension.Z);
        const ySelectionRange = this.host.cubeSelection.getSelectionRangeByDimension(Dimension.Y);
        const xSelectionRange = this.host.cubeSelection.getSelectionRangeByDimension(Dimension.X);

        const xRange = this.host.cubeDimensions.xParameterRange;
        const sliderOffset = this.host.cubeTags.includes(CubeTag.LongitudeZeroIndexIsGreenwich) ? roundUpToSparsity(xRange.length() / 2, this.host.sparsity) : 0;
        const overflowBias = xSelectionRange.length() / xRange.length() * 0.5;
        const overflowXIndex = Math.floor((xSelectionRange.min + sliderOffset) / this.host.cubeDimensions.x.steps + overflowBias);
        if (overflowXIndex != this.lastOverflowXSliderIndex) {
            const newMinimum = roundDownToSparsity(overflowXIndex * this.host.cubeDimensions.x.steps + xRange.min + sliderOffset, this.host.sparsity);
            const newMaximum = roundDownToSparsity(overflowXIndex * this.host.cubeDimensions.x.steps + xRange.max + sliderOffset - 1, this.host.sparsity);
            this.xSelectionSlider.updateOptions({ range: { min: newMinimum, max: newMaximum } }, false);

            this.lastOverflowXSliderIndex = overflowXIndex;

            this.xSelectionSlider.off("update");
            if (this.host.geospatialContextProvided) {
                this.mergeSliderTooltips(this.xSliderDiv as any, 40, " - ");
            }
        }

        if (dimensionsOnly.length == 0 || dimensionsOnly.includes(Dimension.Z)) {
            this.zSelectionSlider.set([zSelectionRange.min, zSelectionRange.max - 1], false);
        }
        if (dimensionsOnly.length == 0 || dimensionsOnly.includes(Dimension.Y)) {
            this.ySelectionSlider.set([ySelectionRange.min, ySelectionRange.max - 1], false);
        }
        if (dimensionsOnly.length == 0 || dimensionsOnly.includes(Dimension.X)) {
            this.xSelectionSlider.set([xSelectionRange.min + sliderOffset * 2, xSelectionRange.max + sliderOffset * 2 - 1], false);
        }
    }

    updateAnimationSliders() {
        const s = this.host.sparsity;

        const constructSlidingRangeWithoutDuplicates = (arr: number[], s: number) => {
            const o: any = {
                'min': [arr[0], s],
                'max': [arr[4], s]
            };
            if (arr[1] != arr[0]) {
                o['25%'] = [arr[1], s];
            }
            if (arr[2] != arr[1]) {
                o['50%'] = [arr[2], s];
            }
            if (arr[3] != arr[2]) {
                o['75%'] = [arr[3], s];
            }
            return o;
        };

        const ap = this.host.animationParameters;
        const windowRange = ap.getExponentialRangeFromLinearRange(ap.getRangeForVisibleWindow());
        this.animationWindowSlider.updateOptions({
            range: constructSlidingRangeWithoutDuplicates(windowRange, s),
            start: [ap.getVisibleWindow()],
            step: s,
            margin: s,
        }, false);

        const incrementRange = ap.getExponentialRangeFromLinearRange(ap.getRangeForIncrementPerStep());
        this.animationIncrementSlider.updateOptions({
            range: constructSlidingRangeWithoutDuplicates(incrementRange, s),
            start: [ap.getIncrementPerStep()],
            step: s,
            margin: s,
        }, false);

        this.animationSpeedSlider.updateOptions({
            range: {
                min: ap.getRangeForFps()[0],
                max: ap.getRangeForFps()[1]
            },
            start: [ap.getFps()],
            step: 1,
            margin: 1,
        }, false);
    }

    updateAnimationDurationLabel() {
        this.htmlAnimationTotalDurationDiv.innerHTML = `${this.host.animationParameters.getFormattedDurationInSeconds()}`;
    }

    /**
     * From: https://refreshless.com/nouislider/examples/
     * @param slider HtmlElement with an initialized slider
     * @param threshold Minimum proximity (in percentages) to merge tooltips
     * @param separator String joining tooltips
     */
    private mergeSliderTooltips(slider: HTMLElement & { noUiSlider: any }, threshold: number, separator: string, useOriginalFormattingCode: boolean = false) {
        var textIsRtl = getComputedStyle(slider).direction === 'rtl';
        var isRtl = slider.noUiSlider.options.direction === 'rtl';
        var isVertical = slider.noUiSlider.options.orientation === 'vertical';
        var tooltips = slider.noUiSlider.getTooltips();
        var origins = slider.noUiSlider.getOrigins();

        tooltips.forEach(function (tooltip: any, index: number) {
            if (tooltip) {
                origins[index].appendChild(tooltip);
            }
        });

        slider.noUiSlider.on('update', function (values: any, handle: any, unencoded: any, tap: any, positions: any) {
            var pools: number[][] = [[]];
            var poolPositions: number[][] = [[]];
            var poolValues: string[][] = [[]];
            var atPool = 0;

            if (tooltips[0]) {
                pools[0][0] = 0;
                poolPositions[0][0] = positions[0];
                poolValues[0][0] = values[0];
            }

            for (var i = 1; i < positions.length; i++) {
                if (!tooltips[i] || (positions[i] - positions[i - 1]) > threshold) {
                    atPool++;
                    pools[atPool] = [];
                    poolValues[atPool] = [];
                    poolPositions[atPool] = [];
                }

                if (tooltips[i]) {
                    pools[atPool].push(i);
                    poolValues[atPool].push(values[i]);
                    poolPositions[atPool].push(positions[i]);
                }
            }

            pools.forEach(function (pool, poolIndex) {
                var handlesInPool = pool.length;

                for (var j = 0; j < handlesInPool; j++) {
                    var handleNumber = pool[j];

                    if (j === handlesInPool - 1) {
                        var offset = 0;

                        poolPositions[poolIndex].forEach(function (value) {
                            offset += 1000 - value;
                        });

                        if (useOriginalFormattingCode) {
                            var direction = isVertical ? 'bottom' : 'right';
                            var last = isRtl ? 0 : handlesInPool - 1;
                            var lastOffset = 1000 - poolPositions[poolIndex][last];
                            offset = (textIsRtl && !isVertical ? 100 : 0) + (offset / handlesInPool) - lastOffset;

                            // Center this tooltip over the affected handles
                            const formatter = (slider.noUiSlider as any).options.tooltips;
                            if (formatter) {
                                tooltips[handleNumber].innerHTML = poolValues[poolIndex].map((str: string) => formatter.to(parseFloat(str))).join(separator);
                            } else {
                                tooltips[handleNumber].innerHTML = poolValues[poolIndex].join(separator);
                            }
                            tooltips[handleNumber].style.display = 'block';
                            tooltips[handleNumber].style[direction] = offset + '%';
                        } else {
                            var isRight = poolPositions[poolIndex].every(p => p > 50);

                            var last = isRtl ? 0 : handlesInPool - 1;
                            var lastOffset = 1000 - poolPositions[poolIndex][last];
                            offset = (textIsRtl && !isVertical ? 100 : 0) + (offset / handlesInPool) - lastOffset;
                            if (handlesInPool > 1) {
                                if (poolPositions[poolIndex].every(p => p > 75)) {
                                    offset = clamp(offset, 15, 85);
                                }
                            }

                            const formatter = (slider.noUiSlider as any).formatter;
                            if (formatter) {
                                tooltips[handleNumber].innerHTML = poolValues[poolIndex].map((str: string) => formatter.to(parseInt(str))).join(separator);
                            } else {
                                tooltips[handleNumber].innerHTML = poolValues[poolIndex].join(separator);
                            }
                            tooltips[handleNumber].style.display = 'block';
                            if (handlesInPool > 1) {
                                tooltips[handleNumber].style['right'] = isRight ? offset + '%' : 'auto';
                                tooltips[handleNumber].style['left'] = !isRight ? (30 - offset) + '%' : 'auto';
                            } else {
                                tooltips[handleNumber].style['right'] = offset + '%';
                                tooltips[handleNumber].style['left'] = 'auto';
                            }
                        }
                    } else {
                        tooltips[handleNumber].style.display = 'none';
                    }
                }
            });
        });
    }

    setNewThresholdAndRangeOptions(newOptions: { range?: { min: number, max: number }, step?: number, margin?: number }) {
        this.volumeVizThresholdSlider.updateOptions(newOptions, false);
        this.volumeVizRangeSlider.updateOptions(newOptions, false);
        
        this.volumeVizRangeSlider.off("update");
        this.mergeSliderTooltips(this.volumeVizRangeSliderDiv as any, 100, " ≤ X ≤ ", true);
    }

    resetOverflowXSliderIndex() {
        this.lastOverflowXSliderIndex = NaN;
    }

    // // Expose quantile slider label for external access
    // getQuantileSliderLabelDiv(): HTMLElement {
    //     // return this.volumeVizQuantileSliderLabelDiv;
    // }

    updateVolumeVizThresholdSliderConnects(thresholdSign: number) {
        const connects = this.volumeVizThresholdSliderDiv.getElementsByClassName("noUi-connect");
        for (let i = 0; i < connects.length; i++) {
            const visible = thresholdSign != 0 && ((i == 0 && thresholdSign < 0) || (i != 0 && thresholdSign > 0));
            (connects[i] as HTMLElement).style.display = visible ? "block" : "none";
        }
    }

    updateVolumeVizSignFromQuantileSliderStatus() {
        this.host.setVolumeRenderingThresholdSign(this.volumeVizQuantileSliderConnectIsLowerActive ? -1 : 1, true);
    }

    updateVolumeVizQuantileSliderSignAndConnects(newValue: number) {
        if (this.volumeVizQuantileSliderConnectIsLowerActive && newValue > NON_EXTREME_QUANTILE_INDEX) {
            this.volumeVizQuantileSliderConnects[0].style.display = "none";
            this.volumeVizQuantileSliderConnects[1].style.display = "block";
            this.volumeVizQuantileSliderConnectIsLowerActive = false;
            this.updateVolumeVizSignFromQuantileSliderStatus();
        } else if (!this.volumeVizQuantileSliderConnectIsLowerActive && newValue < NON_EXTREME_QUANTILE_INDEX) {
            this.volumeVizQuantileSliderConnects[0].style.display = "block";
            this.volumeVizQuantileSliderConnects[1].style.display = "none";
            this.volumeVizQuantileSliderConnectIsLowerActive = true;
            this.updateVolumeVizSignFromQuantileSliderStatus();
        }
    }
}

export { SliderUIManager, SliderUIHostState }
