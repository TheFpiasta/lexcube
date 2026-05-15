import { Vector2, Vector3 } from 'three';
import { clamp } from 'three/src/math/MathUtils';
import { CubeFace, Dimension, TILE_SIZE_2D, TILE_SIZE_3D, capitalizeString } from '../constants';
import type { Tile2D } from '../tiledata';
import type { CubeClientContext } from '../client';
import { GeospatialRange, ParameterRange, getDayString, getTimeString } from './ranges';
import { GeospatialContext } from './geospatial-context';

export { GeospatialRange, ParameterRange, getDayString, getTimeString } from './ranges';
export { GeospatialContext, GeospatialContextCorrection } from './geospatial-context';

export enum CubeDimensionType {
    Generic = 0,
    Time = 1,
    Latitude = 2,
    Longitude = 3,
}

export enum CubeTag {
    SpectralIndices,
    Global,
    AnomaliesOnly,
    Hainich,
    Auwald,
    ESDC,
    ESDC2,
    ESDC3,
    ECMWF,
    ColormappingFromObservedValues,
    LongitudeZeroIndexIsGreenwich,
    CamsEac4Reanalysis,
    OverflowX,
    Era5SpecificHumidity
}

export class CubeDimension {
    private name: string = "Generic Dimension";
    steps: number;
    type: CubeDimensionType = CubeDimensionType.Generic;
    indices: Array<string> | Array<number> | Array<Date>;
    cubeDimensions: CubeDimensions;
    flipped: boolean = false;
    units: string;
    dimension: Dimension;

    constructor(cubeDimensions: CubeDimensions, dimension: Dimension, name: string, steps: number, indices: Array<any>, attrs: any, type: CubeDimensionType | null = null) {
        this.cubeDimensions = cubeDimensions;
        this.dimension = dimension;
        this.name = name;
        this.steps = Math.round(steps);
        this.type = type || this.guessType();
        this.units = attrs ? this.parseUnits(attrs.units) : "";
        if (this.type == CubeDimensionType.Time && !isNaN(new Date(indices[0]).getTime())) {
            this.indices = indices.map((x) => new Date(x));
        } else {
            this.indices = indices;
        }
        if (this.steps !== this.indices.length) {
            console.warn("Dimension indices are mismatched to the dimension steps", this);
        }
    }

    private parseUnits(units: string) {
        if (units == "degrees_north" || units == "degrees_east") {
            return "°";
        }
        return units || "";
    }

    private guessType(): CubeDimensionType {
        if (this.name == "time") {
            return CubeDimensionType.Time;
        } else if (["lat", "latitude"].includes(this.name.toLowerCase())) {
            return CubeDimensionType.Latitude;
        } else if (["lon", "longitude"].includes(this.name.toLowerCase())) {
            return CubeDimensionType.Longitude;
        }
        return CubeDimensionType.Generic;
    }

    private getTimeMetaData() {
        const totalTimeSpanDays = Math.abs(((this.indices[this.indices.length - 1] as Date).getTime() - (this.indices[0] as Date).getTime()) / (1000 * 60 * 60 * 24));
        const millisecondsPerStep = Math.abs(((this.indices[this.indices.length - 1] as Date).getTime() - (this.indices[0] as Date).getTime()) / (this.indices.length - 1));
        const daysPerStep = millisecondsPerStep / (60 * 60 * 24 * 1000);
        const hoursPerStep = millisecondsPerStep / (60 * 60 * 1000);
        const minutesPerStep = millisecondsPerStep / (60 * 1000);
        const secondsPerStep = millisecondsPerStep / 1000;
        return {
            totalTimeSpanDays,
            millisecondsPerStep,
            secondsPerStep,
            hoursPerStep,
            minutesPerStep,
            daysPerStep,
            monthsRelevant: daysPerStep > 60,
            weeksRelevant: daysPerStep > 14.5,
            daysRelevant: daysPerStep > 1,
            hoursRelevant: hoursPerStep > 1,
            minutesRelevant: minutesPerStep > 1,
            secondsRelevant: secondsPerStep >= 1,
            millisecondsRelevant: secondsPerStep < 1,
        }
    }

    private getTimeIndexString(numericIndex: number): string {
        const indexLabel = this.indices[numericIndex];
        if (!(indexLabel instanceof Date)) {
            return `${indexLabel}`;
        }
        const timeData = this.getTimeMetaData();
        return `${timeData.totalTimeSpanDays > 1 ? getDayString(indexLabel as Date) : ""} ${timeData.daysPerStep < 1 ? getTimeString(indexLabel as Date, timeData.millisecondsRelevant) : ""}`.trim();
    }

    getIndexString(numericIndex: number): string {
        let roundedIndex = clamp(Math.floor(numericIndex + 0.001), 0, this.steps - 1);

        if (this.type == CubeDimensionType.Longitude && this.cubeDimensions.context.interaction.cubeTags.includes(CubeTag.LongitudeZeroIndexIsGreenwich)) {
            roundedIndex = Math.floor(numericIndex + 0.001) % this.steps;
        }

        const indexLabel = this.indices[roundedIndex];
        if (this.type == CubeDimensionType.Time) {
            return this.getTimeIndexString(roundedIndex);
        } else if (this.type == CubeDimensionType.Latitude) {
            if (typeof (indexLabel) == "number") {
                return this.cubeDimensions.getLatitudeStringFromIndexValue(indexLabel);
            }
        } else if (this.type == CubeDimensionType.Longitude) {
            if (typeof (indexLabel) == "number") {
                return this.cubeDimensions.getLongitudeStringFromIndexValue(indexLabel);
            }
        } else if (typeof (indexLabel) == "number") {
            if (this.units) {
                return `${indexLabel}${this.getUnits()}`;
            }
            return indexLabel.toLocaleString();
        }
        return `${indexLabel}`;
    }

    private getUnits() {
        if (this.units == "°") {
            return this.units;
        }
        return this.units ? ` ${this.units}` : "";
    }

    hasNumericIndices() {
        const first = this.indices[0];
        return typeof (first) === "number";
    }

    hasTrivialNumericIndices() {
        const first = this.indices[0];
        const last = this.indices[this.indices.length - 1];
        return typeof (first) === "number" && typeof (last) === "number" && first == 0 && last == this.indices.length - 1;
    }

    getDifferenceString(indexDifference: number): { differenceString: string, isExact: boolean } {
        if (this.type == CubeDimensionType.Time) {
            return this.getApproximateTimeDifferenceString(indexDifference);
        }
        if (this.hasTrivialNumericIndices()) {
            return { differenceString: "", isExact: true };
        }
        const first = this.indices[0];
        const last = this.indices[this.indices.length - 1];
        if (typeof (first) !== "number" || typeof (last) !== "number") {
            return { differenceString: "", isExact: true };
        }
        const differencePerStep = Math.abs(last - first) / Math.max(1, this.steps - 1);
        const difference = Math.abs(indexDifference) * differencePerStep;
        const precision = Math.max(0, Math.min(2, -Math.floor(Math.log10(differencePerStep))));
        const d = difference.toFixed(precision);
        const exact = parseFloat(d) == difference;
        if (this.units) {
            return { differenceString: `${d}${this.getUnits()}`, isExact: exact };
        }
        return { differenceString: `${d} unit${d == "1" ? "" : "s"}`, isExact: exact}
    }

    private getApproximateTimeDifferenceString(indexDifference: number) {
        if (this.type != CubeDimensionType.Time || !(this.indices[0] instanceof Date)) {
            return {
                differenceString: `${Math.round(indexDifference).toFixed(0)}`,
                isExact: Math.round(indexDifference) == indexDifference
            };
        }
        const absoluteSteps = Math.abs(indexDifference);
        const timeData = this.getTimeMetaData();
        const totalDaysDifference = absoluteSteps * timeData.daysPerStep;
        const totalHoursDifference = absoluteSteps * timeData.hoursPerStep;
        const totalMinutesDifference = absoluteSteps * timeData.minutesPerStep;
        const totalSecondsDifference = absoluteSteps * timeData.secondsPerStep;

        const displayed = (value: number, unit: string, fractionDigits: number = 0) => {
            const rounded = Math.round(value);
            return {
                differenceString: `${rounded.toFixed(fractionDigits)} ${unit}${rounded != 1 ? "s" : ""}`,
                isExact: rounded == value
            };
        }

        if (totalDaysDifference > 340) {
            return displayed(totalDaysDifference / 365, "year", 1);
        } else if (totalDaysDifference > 60) {
            return displayed(totalDaysDifference / 30, "month");
        } else if (totalDaysDifference > 14.5) {
            return displayed(totalDaysDifference / 7, "week");
        } else if (totalDaysDifference > 1) {
            return displayed(totalDaysDifference, "day");
        } else if (totalHoursDifference > 1) {
            return displayed(totalHoursDifference, "hour");
        } else if (totalMinutesDifference > 1) {
            return displayed(totalMinutesDifference, "minute");
        } else if (totalSecondsDifference > 1) {
            return displayed(totalSecondsDifference, "second");
        } else {
            return displayed(absoluteSteps * timeData.millisecondsPerStep, "millisecond");
        }
    }

    getName() {
        if (this.type == CubeDimensionType.Time) {
            return "Time";
        } else if (this.type == CubeDimensionType.Latitude) {
            return "Latitude";
        } else if (this.type == CubeDimensionType.Longitude) {
            return "Longitude";
        }
        return capitalizeString(this.name);
    }

    getValueRange() {
        if (typeof (this.indices[0]) === "number") {
            return Math.abs((this.indices[0]) - (this.indices[this.indices.length - 1] as number));
        }
        return -1;
    }

    getMaxValue() {
        if (typeof (this.indices[0]) === "number") {
            return Math.max(...this.indices as Array<number>);
        }
        return -1;
    }
}

export class CubeDimensions {
    // Maximum ranges of the whole cube
    x: CubeDimension;
    y: CubeDimension;
    z: CubeDimension;

    // Valid coverage ranges of the current parameter
    zParameterRange: ParameterRange = new ParameterRange(-1, -1, true);
    yParameterRange: ParameterRange = new ParameterRange(-1, -1, true);
    xParameterRange: ParameterRange = new ParameterRange(-1, -1, true);

    private geospatialContext: GeospatialContext = new GeospatialContext();

    context: CubeClientContext;

    constructor(context: CubeClientContext, dimensionNames: string[], dimensionSizes: any, indices: { "x": Array<any>, "y": Array<any>, "z": Array<any> }, coords: any) {
        this.context = context;
        const coordsGiven = coords && Object.keys(coords).length > 0 && coords[dimensionNames[0]] && coords[dimensionNames[1]] && coords[dimensionNames[2]];
        this.x = new CubeDimension(this, Dimension.X, dimensionNames[2], dimensionSizes[dimensionNames[2]], indices["x"], coordsGiven ? coords[dimensionNames[2]]["attrs"] : undefined);
        this.y = new CubeDimension(this, Dimension.Y, dimensionNames[1], dimensionSizes[dimensionNames[1]], indices["y"], coordsGiven ? coords[dimensionNames[1]]["attrs"] : undefined);
        this.z = new CubeDimension(this, Dimension.Z, dimensionNames[0], dimensionSizes[dimensionNames[0]], indices["z"], coordsGiven ? coords[dimensionNames[0]]["attrs"] : undefined);
    }

    setGeospatialContext(geospatialContext: GeospatialContext) {
        this.geospatialContext = geospatialContext;
    }

    isGeospatialContextValid() {
        return this.geospatialContext.isValid();
    }

    totalWidthForFace(face: CubeFace) {
        if (face <= 3) {
            return this.x.steps;
        } else {
            return this.y.steps;
        }
    }

    totalHeightForFace(face: CubeFace) {
        if (face <= 1) {
            return this.y.steps;
        } else {
            return this.z.steps;
        }
    }

    totalSize() {
        return new Vector3(this.x.steps, this.y.steps, this.z.steps);
    }

    xParameterRangeForFace(face: CubeFace) {
        if (face <= 3) {
            return this.xParameterRange;
        } else {
            return this.yParameterRange;
        }
    }

    yParameterRangeForFace(face: CubeFace) {
        if (face <= 1) {
            return this.yParameterRange;
        } else {
            return this.zParameterRange;
        }
    }

    getOverflowEdgeTileInfo(tile: Tile2D) {
        const xTiles = this.xTilesForFace(tile.face, tile.lod);
        const yTiles = this.yTilesForFace(tile.face, tile.lod);
        const xTilesUnrounded = this.xTilesForFaceUnrounded(tile.face, tile.lod);
        const yTilesUnrounded = this.yTilesForFaceUnrounded(tile.face, tile.lod);

        const overflowingX = tile.x == xTiles - 1 && xTiles != xTilesUnrounded;
        const overflowingY = tile.y == yTiles - 1 && yTiles != yTilesUnrounded;

        if (overflowingX || overflowingY) {
            return { overflowing: true,
                overflowingX,
                overflowingY,
                xCutoff: overflowingX ? Math.floor((xTilesUnrounded % 1) * TILE_SIZE_2D) : TILE_SIZE_2D,
                yCutoff: overflowingY ? Math.floor((yTilesUnrounded % 1) * TILE_SIZE_2D) : TILE_SIZE_2D
            };
        }
        return { overflowing: false, overflowingX: false, overflowingY: false, xCutoff: 0, yCutoff: 0 };
    }

    private xTilesForFaceUnrounded(face: CubeFace, lod: number) {
        return (this.totalWidthForFace(face) * Math.pow(0.5, lod)) / TILE_SIZE_2D;
    }

    xTilesForFace(face: CubeFace, lod: number) {
        return Math.ceil(this.xTilesForFaceUnrounded(face, lod));
    }

    private yTilesForFaceUnrounded(face: CubeFace, lod: number) {
        return (this.totalHeightForFace(face) * Math.pow(0.5, lod)) / TILE_SIZE_2D;
    }

    yTilesForFace(face: CubeFace, lod: number) {
        return Math.ceil(this.yTilesForFaceUnrounded(face, lod));
    }

    tiles2dForFace(face: CubeFace, lod: number) {
        return new Vector2(this.xTilesForFace(face, lod), this.yTilesForFace(face, lod));
    }

    total3dTiles(lod: number) {
        const xTiles = Math.ceil((this.x.steps * Math.pow(0.5, lod)) / TILE_SIZE_3D);
        const yTiles = Math.ceil((this.y.steps * Math.pow(0.5, lod)) / TILE_SIZE_3D);
        const zTiles = Math.ceil((this.z.steps * Math.pow(0.5, lod)) / TILE_SIZE_3D);
        return new Vector3(xTiles, yTiles, zTiles);
    }

    getLatitudeStringFromIndexValue(latitudeValue: number) {
        return `${this.decimalCoordinateToString(latitudeValue)}${latitudeValue >= 0 ? "N" : "S"}`;
    }

    getGeospatialTotalRangeX() {
        return this.geospatialContext.xRange;
    }

    getGeospatialTotalRangeY() {
        return this.geospatialContext.yRange;
    }

    getGeospatialSubRangeX(first: number, last: number) {
        const xRange = this.getGeospatialTotalRangeX().range();
        return new GeospatialRange(this.getGeospatialValueXFromIndex(first), this.getGeospatialValueXFromIndex(last), this.context.rendering.dimensionOverflow[Dimension.X], xRange);
    }

    getGeospatialSubRangeY(first: number, last: number) {
        return new GeospatialRange(this.getGeospatialValueYFromIndex(first), this.getGeospatialValueYFromIndex(last));
    }

    getGeospatialValueXFromIndex(step: number): number {
        if (!this.geospatialContext.isValid()){
            return NaN;
        }
        let xValue = this.geospatialContext.xRange.getValueWithin(step / (this.x.steps - 1));
        return xValue;
    }

    getGeospatialValueYFromIndex(step: number) {
        if (!this.geospatialContext.isValid()) {
            return NaN;
        }
        const yValue = this.geospatialContext.yRange.getValueWithin(step / (this.y.steps - 1));
        return yValue;
    }

    getLongitudeStringFromIndexValue(longitudeValue: number): string {
        if (this.context.interaction.isCurrentCubeZeroIndexGreenwich() && longitudeValue >= 180) {
            longitudeValue -= 360;
        }
        return `${this.decimalCoordinateToString(longitudeValue)}${longitudeValue >= 0 ? "E" : "W"}`;
    }

    private decimalCoordinateToString(coordinate: number) {
        const absolute = Math.abs(coordinate);
        const degrees = Math.floor(absolute);
        const minutes = (absolute - degrees) * 60;
        const wholeMinutes = Math.floor(minutes);
        const seconds = Math.floor((minutes - wholeMinutes) * 60);
        return `${degrees}°${wholeMinutes}'${seconds}"`;
    }

    setInitialParameterRanges(parameterCoverageTime: ParameterRange) {
        const int = this.context.interaction;
        if (this.z.type == CubeDimensionType.Time && parameterCoverageTime.length() > 0) {
            this.zParameterRange.set(int.roundUpToSparsity(parameterCoverageTime.min), int.roundDownToSparsity(parameterCoverageTime.max - 1) + 1);
        } else {
            this.zParameterRange.set(0, int.roundDownToSparsity(this.z.steps - 1) + 1);
        }

        this.xParameterRange.set(0, int.roundDownToSparsity(this.x.steps - 1) + 1);
        this.yParameterRange.set(0, int.roundDownToSparsity(this.y.steps - 1) + 1);
    }

    getParameterRangeByDimension(dimension: Dimension) {
        if (dimension == Dimension.X) {
            return this.xParameterRange;
        } else if (dimension == Dimension.Y) {
            return this.yParameterRange;
        } else {
            return this.zParameterRange;
        }
    }

    getCubeDimensionByDimension(dimension: Dimension) {
        if (dimension == Dimension.X) {
            return this.x;
        } else if (dimension == Dimension.Y) {
            return this.y;
        } else {
            return this.z;
        }
    }
}
