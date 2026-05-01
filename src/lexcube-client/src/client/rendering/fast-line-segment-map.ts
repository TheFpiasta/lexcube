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

class FastLineSegmentMap {
    private minValue: number;
    private maxValue: number;
    private binCount: number;
    private binSize: number;
    private tree: number[][];

    constructor(component: number, bins: number, positions: number[], indices: number[]) {
        // component == 1: Y, component == 2: Z
        this.binCount = bins;
        this.minValue = positions.reduce((prev, curr, i) => i % 3 == component ? Math.min(prev, curr) : prev, Infinity);
        this.maxValue = positions.reduce((prev, curr, i) => i % 3 == component ? Math.max(prev, curr) : prev, -Infinity) + 0.0001;

        this.binSize = (this.maxValue - this.minValue) / this.binCount;
        this.tree = new Array(this.binCount).fill(0).map(() => []);

        this.construct(component, indices, positions);
    }

    static fromObject(obj: any): FastLineSegmentMap {
        const instance = Object.create(FastLineSegmentMap.prototype);
        return Object.assign(instance, obj);
    }

    private construct(component: number, indices: number[], positions: number[]) {
        for (let p = 0; p < indices.length; p += 2) {
            const p1Index = indices[p] * 3;
            const p2Index = indices[p + 1] * 3;
            const p1BinIndex = Math.floor((positions[p1Index + component] - this.minValue) / this.binSize);
            const p2BinIndex = Math.floor((positions[p2Index + component] - this.minValue) / this.binSize);
            const lowerBinIndex = Math.min(p1BinIndex, p2BinIndex);
            const upperBinIndex = Math.max(p1BinIndex, p2BinIndex);
 
            for (let binIndex = lowerBinIndex; binIndex <= upperBinIndex; binIndex++) {
                this.tree[binIndex].push(p1Index / 3, p2Index / 3);
            }
        }
    }

    getAllIndicesAtValue(value: number) {
        const binIndex = Math.floor((value - this.minValue) / this.binSize);
        return this.tree[binIndex] || [];
    }
}

export default FastLineSegmentMap;
