import { Object3D } from 'three';
import { CubeFace, Dimension } from '../constants';
import type { CubeInteraction } from '../interaction';

export class TimeSeries {
    static nextId: number = 1;
    id: number;
    face: CubeFace;
    x: number;
    y: number;
    data: number[];
    labels: string[];
    marker: Object3D | undefined;
    pointColor: string;
    private insertedDataLength: number = 0;

    constructor(face: CubeFace, x: number, y: number, pointColor: string) {
        this.id = TimeSeries.nextId++;
        this.face = face;
        this.x = x;
        this.y = y;
        this.data = [];
        this.pointColor = pointColor;
        this.labels = [];
    }

    getPointColor() {
        return this.pointColor;
    }

    insertData(newData: number[], zStart: number, cubeInteraction: CubeInteraction) {
        const insertedLength = Math.min(newData.length, this.data.length - zStart);
        this.insertedDataLength += insertedLength;
        this.data.splice(zStart, insertedLength, ...newData.slice(0, insertedLength).map((b) => cubeInteraction.getConvertedDataValue(b)));
        return this.insertedDataLength >= this.data.length;
    }

    getRequestedDataRange() {
        return {
            indexDimension: Dimension.X,
            globalX: this.x,
            globalY: this.y,
        };
    }
}
