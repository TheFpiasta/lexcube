import { Dimension } from '../constants';
import { CubeDimensions } from '../core/dimensions';
import { CubeSelection } from '../core/selection';
import { AnimationParameters } from '../core/animation';
import { clear } from 'console';


const CSS_TURN_RED_FILTER = "brightness(0) saturate(100%) invert(37%) sepia(72%) saturate(6374%) hue-rotate(344deg) brightness(122%) contrast(117%)";


interface AnimationUIHostState {
    get animationParameters(): AnimationParameters;
    get cubeDimensions(): CubeDimensions;
    get cubeSelection(): CubeSelection;
    get animationRecordingSupported(): boolean;
    get recordAnimation(): boolean;
    set recordAnimation(value: boolean);
    log(...args: any[]): void;
    onStartAnimation(): void;
    onStopAnimation(): void;
    onStartRecording(fps: number): void;
    onStopRecording(): void;
    onAnimationDimensionChanged(dimension: Dimension): void;
    onAnimationSelectedRangeOnlyChanged(): void;
    onRecordingFormatChanged(format: string): void;
    showAnimationSettingsHover(hideIfAlreadyShown: boolean): void;
    get isTouchDevice(): boolean;
}


class AnimationUIManager {
    private host: AnimationUIHostState;

    // HTML elements
    private htmlAnimateStartButton!: HTMLElement;
    private htmlAnimateStopButton!: HTMLElement;
    private htmlAnimationDropdown!: HTMLElement;
    private htmlAnimationRecordingCheckbox!: HTMLInputElement;
    private htmlAnimationRecordingCheckboxLabel!: HTMLElement;
    private htmlAnimationSelectedRangeOnlyCheckbox!: HTMLInputElement;
    private htmlAnimationSelectedRangeOnlyCheckboxLabelDiv!: HTMLElement;
    private htmlAnimationDimensionSelect!: HTMLSelectElement;
    private htmlAnimationRecordingSection!: HTMLElement;
    private htmlAnimationRecordingInProgressPanel!: HTMLElement;
    private htmlAnimationRecordingOptions!: HTMLElement;
    private htmlAnimationRecordingFormatSelect!: HTMLSelectElement;
    private htmlAnimationRecordingRestartButton!: HTMLButtonElement;
    private htmlAnimationRecordingStopButton!: HTMLButtonElement;

    constructor(host: AnimationUIHostState) {
        this.host = host;
    }

    setupHtmlReferences(htmlParent: HTMLElement) {
        const getByClass = (className: string) => {
            const elements = htmlParent.getElementsByClassName(className);
            if (elements.length != 1) {
                console.warn("Tried to access HTML element of class name", className, "but got", elements.length, "results.")
            }
            return elements[0] as HTMLElement;
        };

        this.htmlAnimateStartButton = getByClass('animate-start-button');
        this.htmlAnimateStopButton = getByClass('animate-stop-button');
        this.htmlAnimationDropdown = getByClass('animation-dropdown-content');
        this.htmlAnimationRecordingCheckbox = getByClass('animation-recording-checkbox') as HTMLInputElement;
        this.htmlAnimationRecordingCheckboxLabel = getByClass('animation-recording-checkbox-label');
        this.htmlAnimationSelectedRangeOnlyCheckbox = getByClass('animation-selected-range-only-checkbox') as HTMLInputElement;
        this.htmlAnimationSelectedRangeOnlyCheckboxLabelDiv = getByClass('animation-selected-range-only-checkbox-label-div');
        this.htmlAnimationDimensionSelect = getByClass('animation-dimension-select') as HTMLSelectElement;
        this.htmlAnimationRecordingSection = getByClass('animation-recording-section');
        this.htmlAnimationRecordingInProgressPanel = getByClass('animation-recording-in-progress-panel');
        this.htmlAnimationRecordingOptions = getByClass('animation-recording-options');
        this.htmlAnimationRecordingFormatSelect = getByClass('animation-recording-format') as HTMLSelectElement;
        this.htmlAnimationRecordingRestartButton = getByClass('animation-recording-restart-button') as HTMLButtonElement;
        this.htmlAnimationRecordingStopButton = getByClass('animation-recording-stop-button') as HTMLButtonElement;
    }

    setupEventHandlers() {
        try {
            // @ts-expect-error
            MediaStreamTrackProcessor as any;
            VideoEncoder as any;
        } catch (e: unknown) {
            this.htmlAnimationRecordingCheckbox.disabled = true;
            this.htmlAnimationRecordingCheckboxLabel.style.color = "grey";
            this.htmlAnimationRecordingCheckboxLabel.innerHTML += " (not supported in this browser)";
        }

        this.htmlAnimationRecordingCheckbox.onchange = () => {
            this.host.recordAnimation = this.htmlAnimationRecordingCheckbox.checked;
            this.htmlAnimateStartButton.style.filter = this.host.recordAnimation ? CSS_TURN_RED_FILTER : "";
            this.htmlAnimationRecordingOptions.style.display = this.host.recordAnimation ? "contents" : "none";
        };

        this.htmlAnimationSelectedRangeOnlyCheckbox.onchange = () => {
            this.host.onAnimationSelectedRangeOnlyChanged();
        };

        this.htmlAnimationRecordingRestartButton.onclick = () => {
            this.host.onStartAnimation();
        };

        this.htmlAnimationRecordingStopButton.onclick = () => {
            this.host.onStopAnimation();
        };

        this.htmlAnimationRecordingFormatSelect.onchange = () => {
            this.host.onRecordingFormatChanged(this.htmlAnimationRecordingFormatSelect.value);
        };

        this.htmlAnimationDimensionSelect.onchange = () => {
            this.host.onAnimationDimensionChanged(Dimension[this.htmlAnimationDimensionSelect.value.toUpperCase() as keyof typeof Dimension]);
        };

        const longTouchDuration = 250; // milliseconds
        let touchBeginTimeout = 0;
        let isUsingTouches = false;

        this.htmlAnimateStartButton.onmouseenter = () => {
            if (isUsingTouches) {
                return;
            }
            this.host.showAnimationSettingsHover(false);
        };

        this.htmlAnimateStopButton.onmouseenter = () => {
            if (isUsingTouches) {
                return;
            }
            this.host.showAnimationSettingsHover(false);
        };

        this.htmlAnimateStartButton.ontouchstart = () => {
            isUsingTouches = true;
            touchBeginTimeout = window.setTimeout(() => {
                this.host.showAnimationSettingsHover(true);
                clearTimeout(touchBeginTimeout);
                touchBeginTimeout = 0;
            }, longTouchDuration);
        }

        this.htmlAnimateStartButton.ontouchend = () => {
            if (touchBeginTimeout) {
                clearTimeout(touchBeginTimeout);
                this.host.onStartAnimation();
                touchBeginTimeout = 0;
            }
        }

        this.htmlAnimateStopButton.ontouchstart = () => {
            isUsingTouches = true;
            touchBeginTimeout = window.setTimeout(() => {
                this.host.showAnimationSettingsHover(true);
                clearTimeout(touchBeginTimeout);
                touchBeginTimeout = 0;
            }, longTouchDuration);
        }

        this.htmlAnimateStopButton.ontouchend = () => {
            if (touchBeginTimeout) {
                clearTimeout(touchBeginTimeout);
                this.host.onStopAnimation();
                touchBeginTimeout = 0;
            }
        }

        this.htmlAnimateStartButton.onclick = () => {
            if (isUsingTouches) {
                return;
            }
            this.host.onStartAnimation();
        };

        this.htmlAnimateStopButton.onclick = () => {
            if (isUsingTouches) {
                return;
            }
            this.host.onStopAnimation();
        };
    }

    showDropdown(hideIfAlreadyShown: boolean = false) {
        if (hideIfAlreadyShown && this.htmlAnimationDropdown.style.display === "block") {
            this.htmlAnimationDropdown.style.display = "none";
        } else {
            this.htmlAnimationDropdown.style.display = "block";
        }
    }

    hideDropdown() {
        this.htmlAnimationDropdown.style.display = "none";
    }

    startRecordingUi() {
        this.htmlAnimationRecordingCheckbox.disabled = true;
        this.htmlAnimationRecordingCheckboxLabel.style.display = "none";
        this.htmlAnimationRecordingInProgressPanel.style.display = "contents";
        this.htmlAnimationRecordingOptions.style.display = "none";
    }

    stopRecordingUi() {
        this.htmlAnimationRecordingCheckbox.disabled = false;
        this.htmlAnimationRecordingCheckboxLabel.style.display = "block";
        this.htmlAnimationRecordingInProgressPanel.style.display = "none";
        this.htmlAnimationRecordingOptions.style.display = "contents";
    }

    resetRecordingUiPostDownload() {
        this.htmlAnimationRecordingRestartButton.innerText = "Start Recording";
        this.htmlAnimationRecordingRestartButton.style.fontStyle = "";
        this.htmlAnimationRecordingRestartButton.style.backgroundColor = "";
        this.htmlAnimationRecordingRestartButton.disabled = false;
    }

    showStartButton() {
        this.htmlAnimateStartButton.style.display = "block";
        this.htmlAnimateStopButton.style.display = "none";
    }

    showStopButton(isRecording: boolean) {
        this.htmlAnimateStartButton.style.display = "none";
        this.htmlAnimateStopButton.style.filter = isRecording ? CSS_TURN_RED_FILTER : "";
        this.htmlAnimateStopButton.style.display = "block";
    }

    disableControlsDuringAnimation() {
        this.htmlAnimationSelectedRangeOnlyCheckbox.disabled = true;
        this.htmlAnimationDimensionSelect.disabled = true;
        this.htmlAnimationRecordingCheckbox.disabled = true;
    }

    enableControlsAfterAnimation() {
        this.htmlAnimationSelectedRangeOnlyCheckbox.disabled = false;
        this.htmlAnimationDimensionSelect.disabled = false;
        this.htmlAnimationRecordingCheckbox.disabled = !this.host.animationRecordingSupported;
    }

    showRecordingProcessingState() {
        this.htmlAnimationRecordingRestartButton.innerText = "Processing video...";
        this.htmlAnimationRecordingRestartButton.style.fontStyle = "italic";
        this.htmlAnimationRecordingRestartButton.style.backgroundColor = "grey";
        this.htmlAnimationRecordingRestartButton.disabled = true;
    }

    updateSelectedRangeOnlyLabel() {
        const d = this.host.animationParameters.getDimension();
        const cd = this.host.cubeDimensions.getCubeDimensionByDimension(d);
        const range = this.host.cubeSelection.getSelectionRangeByDimension(d);
        const p1 = cd.getIndexString(range.min);
        const p2 = cd.getIndexString(range.max - 1);
        this.htmlAnimationSelectedRangeOnlyCheckboxLabelDiv.innerHTML = ` Only animate last selection (${p1} - ${p2})`;
    }

    isSelectedRangeOnlyChecked(): boolean {
        return this.htmlAnimationSelectedRangeOnlyCheckbox.checked;
    }

    setSelectedRangeOnlyChecked(checked: boolean) {
        this.htmlAnimationSelectedRangeOnlyCheckbox.checked = checked;
    }

    updateDimensionSelectLabels() {
        this.htmlAnimationDimensionSelect.options[0].text = this.host.cubeDimensions.x.getName();
        this.htmlAnimationDimensionSelect.options[1].text = this.host.cubeDimensions.y.getName();
        this.htmlAnimationDimensionSelect.options[2].text = this.host.cubeDimensions.z.getName();
    }

    setDimensionSelectValue(value: string) {
        this.htmlAnimationDimensionSelect.value = value;
    }

    // Expose for orchestration mode setup
    hideRecordingSection() {
        this.htmlAnimationRecordingSection.style.display = "none";
    }
}

export { AnimationUIManager, AnimationUIHostState, CSS_TURN_RED_FILTER }
