import { CubeDimensions } from '../core/dimensions';

export enum ExtremeThresholdTarget {
    Observations,
    DeviationsFromMSC
}

export enum ExtremeThresholdType {
    Absolute,
    Quantile
}

export enum ExtremeSpatialQuantileContext {
    AllTimeSeries,
    PcaGroupedTimeSeries,
    SingleTimeSeries
}

export class ExtremeType {
    readonly id: number;
    readonly name: string;
    readonly thresholdTarget: ExtremeThresholdTarget;
    readonly thresholdType: ExtremeThresholdType;
    readonly spatialQuantileContext: ExtremeSpatialQuantileContext | null;

    constructor(id: number, name: string, thresholdTarget: ExtremeThresholdTarget, thresholdType: ExtremeThresholdType, spatialQuantileContext: ExtremeSpatialQuantileContext | null = null) {
        this.id = id;
        this.name = name;
        this.thresholdTarget = thresholdTarget;
        this.thresholdType = thresholdType;
        this.spatialQuantileContext = spatialQuantileContext;
    }
}

export class ExtremeEvent {
    constructor(public eventIndex: number, public startIndex: number, public endIndex: number, public minXIndex: number, public maxXIndex: number, public minYIndex: number, public maxYIndex: number, public areaKm2: number, public nObservations: number) {}

    static fromDataView(eventIndex: number, dataView: DataView, offset: number): ExtremeEvent {
        const startIndex = dataView.getUint16(offset, true);
        const endIndex = dataView.getUint16(offset + 2, true);
        const minXIndex = dataView.getUint16(offset + 4, true);
        const maxXIndex = dataView.getUint16(offset + 6, true);
        const minYIndex = dataView.getUint16(offset + 8, true);
        const maxYIndex = dataView.getUint16(offset + 10, true);
        const areaKm2 = dataView.getUint32(offset + 12, true);
        const nObservations = dataView.getUint32(offset + 16, true);
        return new ExtremeEvent(eventIndex, startIndex, endIndex, minXIndex, maxXIndex, minYIndex, maxYIndex, areaKm2, nObservations);
    }

    toTableRow(cubeDimensions: CubeDimensions): string {
        const firstTimeIndex = cubeDimensions.z.getIndexString(this.startIndex);
        const durationString = cubeDimensions.z.getDifferenceString(this.endIndex - this.startIndex + 1).differenceString;
        const timeRangeString = `${firstTimeIndex}<br>+ ca. ${durationString}`;
        const spaceCoverageString = `${(this.areaKm2 / 1000).toFixed(0)}k km²<br>(${this.maxXIndex - this.minXIndex + 1}×${this.maxYIndex - this.minYIndex + 1})`;
        const centerXYString = `${cubeDimensions.x.getIndexString(Math.floor((this.minXIndex + this.maxXIndex) / 2))} / ${cubeDimensions.y.getIndexString(Math.floor((this.minYIndex + this.maxYIndex) / 2))}`;
        return `<tr><td>#${this.eventIndex}</td><td>${this.nObservations} obs</td><td>${timeRangeString}</td><td>${spaceCoverageString}</td><td>${centerXYString}</td></tr>`;
    }
}
