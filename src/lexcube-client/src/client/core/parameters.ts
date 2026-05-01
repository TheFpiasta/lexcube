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
 * Parameter management classes extracted from interaction.ts
 *
 * This module contains:
 * - ParameterColormapMetadata: Colormap configuration for a parameter
 * - ParameterAttributionMetadata: Attribution/source information for a parameter
 * - Parameter: Full parameter definition with metadata, units, and conversion logic
 */

import { ParameterRange } from './dimensions';
import { DataType, WATER_RELATED_VARIABLE_KEYWORDS, ANOMALY_PARAMETER_ID_SUFFIX } from '../constants';

export class ParameterColormapMetadata {
    key!: string;
    colormapMinimumValue?: number;
    colormapMaximumValue?: number;
    colormap?: string;
    colormapFlipped?: boolean;
}

export class ParameterAttributionMetadata {
    project_name!: string;
    long_name!: string;
    dataset_link!: string;
    key!: string;
    domain!: string;
    short_name!: string;
    description!: string;
    long_name_pdf?: string;
    coverage?: string;
    references?: string;
    reference_link?: string;
    reference_link2?: string;
}

export class Parameter {
    constructor(name: string, sourceData: any, attributionData: ParameterAttributionMetadata | undefined, colormapData: ParameterColormapMetadata | undefined, isAnomalyDataset: boolean) {
        this.name = name;

        this.attributionMetadata = attributionData;
        this.coverageStartDate = new Date(sourceData.attrs.time_coverage_start);
        this.coverageEndDate = new Date(sourceData.attrs.time_coverage_end);
        this.longName = sourceData.attrs.long_name || attributionData?.long_name;
        this.comment = sourceData.attrs.comment;
        this.project = attributionData?.project_name || sourceData.attrs.project_name || "";
        this.units = sourceData.attrs.units || "";
        this.unitConversion = (a: number) => a;
        this.minimumValue = sourceData.minimum_value;
        this.maximumValue = sourceData.maximum_value;
        this.realisticMinimumValueViaQuantiles = sourceData.median_of_1quantiles;
        this.realisticMaximumValueViaQuantiles = sourceData.median_of_99quantiles;
        this.fixedColormapMinimumValue = (colormapData?.colormapMinimumValue !== undefined) ? colormapData.colormapMinimumValue : undefined;
        this.fixedColormapMaximumValue = (colormapData?.colormapMaximumValue !== undefined) ? colormapData.colormapMaximumValue : undefined;
        this.fixedColormap = colormapData?.colormap || undefined;
        this.fixedColormapFlipped = colormapData?.colormapFlipped || false;
        this.sourceData = sourceData;
        this.dataType = sourceData.attrs && sourceData.attrs.rgb_source_bands ? DataType.RGB : DataType.Float;
        this.rgbSourceBands = sourceData.attrs && sourceData.attrs.rgb_source_bands ? sourceData.attrs.rgb_source_bands : undefined;
        this.rgbScale = sourceData.attrs && sourceData.attrs.rgb_scale ? sourceData.attrs.rgb_scale : undefined;
        this.parameterCoverageTime = new ParameterRange(sourceData["first_valid_time_slice"], sourceData["last_valid_time_slice"] + 1);
        this.isAnomalyDataset = isAnomalyDataset;
        this.patchMetadata();
    }

    getConvertedDataValue(value: number) {
        return this.unitConversion(value);
    }

    private patchMetadata() {
        if (this.name == "precipitation_era5") {
            this.units = "mm day-1"
            this.unitConversion = (a: number) => a * 100;
        } else if (["k", "kelvin"].includes(this.units.toLowerCase()) && (this.maximumValue > 273.15 || this.isAnomalyParameter())) {
            this.units = "°C";
            if (!this.isAnomalyParameter()) {
                this.unitConversion = (a: number) => a - 273.15;
            }
        } else if (this.units == "mol m-2") {
            this.units = "mmol m-2";
            this.unitConversion = (a: number) => a * 1000;
        } else if (this.units == "J/m^2") {
            this.units = "MJ/m^2";
            this.unitConversion = (a: number) => a / 1000000;
        } else if (this.units == "g/m2") {
            this.units = "kg/m^2";
            this.unitConversion = (a: number) => a / 1000;
        } else if (this.units == "kg m**-2") {
            const target = -Math.round(Math.log10(this.maximumValue) / 3);
            if (target >= 0) {
                this.units = `${["kg", "g", "mg", "μg", "ng"][target]} m**-2`;
                this.unitConversion = (a: number) => a * Math.pow(10, 3 * target);
            }
        } else if (this.name == "tp" && this.units == "m") {
            this.units = "mm";
            this.unitConversion = (a: number) => a * 1000;
        } else if (this.units == "m**3 m**-3") {
            this.units = "m**3/m**3";
        } else if (this.name == "siconc") {
            this.units = "%";
            this.unitConversion = (a: number) => a * 100;
        }
    }

    getUnit() {
        if (["1", "-", "~"].includes(this.units)) {
            return "";
        } else {
            return `${this.units}`
        }
    }

    getUnitHTML() {
        return this.getUnit().replace(/(\w)(-?\d)/g, "$1<sup>$2</sup>").replace(/(\w)\^(-?\d)/g, "$1<sup>$2</sup>").replace(/(\w)\*\*(-?\d)/g, "$1<sup>$2</sup>")
    }

    higherAnomalyIsBlueInsteadOfRed() {
        const name = `${this.name}-${this.longName}`;
        return WATER_RELATED_VARIABLE_KEYWORDS.some((k) => name.toLowerCase().includes(k));
    }

    isAnomalyParameter() {
        return this.name.endsWith(ANOMALY_PARAMETER_ID_SUFFIX) || this.isAnomalyDataset;
    }

    getRgbDataValueString(dataValue: Uint8Array, isDataNan: boolean | boolean[]) {
        return ["R", "G", "B"].map((channelName, i) => {
            const unscaledValue = this.rgbScale ? dataValue[i] * this.rgbScale[i] : dataValue[i];
            let dataValueStr = `${dataValue[i]} (${unscaledValue})`;
            if (isDataNan instanceof Array && isDataNan[i]) {
                dataValueStr = "NaN";
            }
            return `${this.rgbSourceBands![i]} (${channelName}): ${dataValueStr}`;
        })
    }

    sourceData: any;
    name: string;
    parameterCoverageTime: ParameterRange;
    coverageStartDate: Date;
    coverageEndDate: Date;
    longName: string;
    comment: string;
    project: string;
    maximumValue: number;
    minimumValue: number;
    realisticMinimumValueViaQuantiles: number;
    realisticMaximumValueViaQuantiles: number;
    attributionMetadata: ParameterAttributionMetadata | undefined;
    fixedColormapMinimumValue: number | undefined;
    fixedColormapMaximumValue: number | undefined;
    fixedColormap: string | undefined;
    fixedColormapFlipped: boolean;
    dataType: DataType;
    rgbSourceBands: string[] | undefined;
    rgbScale: number[] | undefined;
    private isAnomalyDataset: boolean;
    private units: string;
    private unitConversion: (a: number) => number;
}
