import { GeospatialRange } from './ranges';
import type { CubeDimensions } from './dimensions';

export enum GeospatialContextCorrection {
    None,
    AddHalfStepAtBothEnds,
    AddFullStepAtEnd,
}

export class GeospatialContext {
    xRange: GeospatialRange = new GeospatialRange(NaN, NaN);
    yRange: GeospatialRange = new GeospatialRange(NaN, NaN);

    setGlobalCoverage() {
        this.xRange.set(-180, 180);
        this.yRange.set(-90, 90);
    }

    setFromDimensions(cubeDimensions: CubeDimensions, xCorrection: GeospatialContextCorrection, yCorrection: GeospatialContextCorrection) {
        if (!cubeDimensions.x.hasNumericIndices() || !cubeDimensions.y.hasNumericIndices()) {
            return "Indices are not numeric, not setting geospatial context.";
        }
        const xBounds = [cubeDimensions.x.indices[0] as number, cubeDimensions.x.indices[cubeDimensions.x.indices.length - 1] as number];
        const xAscending = xBounds[0] < xBounds[1];
        const xMin = Math.min(...xBounds);
        const xMax = Math.max(...xBounds);
        const yBounds = [cubeDimensions.y.indices[0] as number, cubeDimensions.y.indices[cubeDimensions.y.indices.length - 1] as number];
        const yAscending = yBounds[0] < yBounds[1];
        const yMin = Math.min(...yBounds);
        const yMax = Math.max(...yBounds);

        const xStep = Math.abs(xMax - xMin) / (cubeDimensions.x.steps - 1);
        const yStep = Math.abs(yMax - yMin) / (cubeDimensions.y.steps - 1);

        if (xCorrection == GeospatialContextCorrection.AddHalfStepAtBothEnds) {
            this.xRange.setFromMinMaxAscending(xMin - xStep / 2, xMax + xStep / 2, xAscending);
        } else if (xCorrection == GeospatialContextCorrection.AddFullStepAtEnd) {
            this.xRange.setFromMinMaxAscending(xMin, xMax + xStep, xAscending);
        } else if (xCorrection == GeospatialContextCorrection.None) {
            this.xRange.setFromMinMaxAscending(xMin, xMax, xAscending);
        } else {
            console.error("Unknown geospatial context xCorrection type: " + xCorrection);
        }
        if (yCorrection == GeospatialContextCorrection.AddHalfStepAtBothEnds) {
            this.yRange.setFromMinMaxAscending(yMin - yStep / 2, yMax + yStep / 2, yAscending);
        } else if (yCorrection == GeospatialContextCorrection.AddFullStepAtEnd) {
            this.yRange.setFromMinMaxAscending(yMin, yMax + yStep, yAscending);
        } else if (yCorrection == GeospatialContextCorrection.None) {
            this.yRange.setFromMinMaxAscending(yMin, yMax, yAscending);
        } else {
            console.error("Unknown geospatial context yCorrection type: " + yCorrection);
        }
        return `xRange set to [${this.xRange.min}, ${this.xRange.max}] (using correction ${GeospatialContextCorrection[xCorrection]} from ${xBounds[0]} to ${xBounds[1]}). yRange set to [${this.yRange.min}, ${this.yRange.max}] (using correction ${GeospatialContextCorrection[yCorrection]} from ${yBounds[0]} to ${yBounds[1]}).`;
    }

    isValid() {
        return this.xRange.isValid() && this.yRange.isValid();
    }
}
