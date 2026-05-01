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

import FastLineSegmentMap from "./fast-line-segment-map";
import { expose } from 'comlink';


const parseGeoJSON = async (geoJsonOrUrl: any, segmentMapBins: number) => {
    if (geoJsonOrUrl == null) {
        throw new Error("GeoJSON or URL is required");
    }
    if (geoJsonOrUrl instanceof String || typeof geoJsonOrUrl == "string") {
        if (geoJsonOrUrl.startsWith("http") || geoJsonOrUrl.startsWith("/")) {
            const loadedBorders = await fetch(geoJsonOrUrl as string);
            geoJsonOrUrl = await loadedBorders.json();
        } else {
            geoJsonOrUrl = JSON.parse(geoJsonOrUrl as string);
        }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let feature of geoJsonOrUrl.features) {
        const coords = feature.geometry.type == "MultiPolygon" ? feature.geometry.coordinates.flat(2) : feature.geometry.type == "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.type == "MultiLineString" ? feature.geometry.coordinates.flat() : feature.geometry.type == "LineString" ? feature.geometry.coordinates : feature.geometry.type == "MultiPoint" ? feature.geometry.coordinates : feature.geometry.type == "Point" ? [feature.geometry.coordinates] : null;
        if (coords) {
            for (let coord of coords) {
                const x = coord[0] as number;
                const y = coord[1] as number;
                if (minX === undefined || x < minX) {
                    minX = x;
                }
                if (maxX === undefined || x > maxX) {
                    maxX = x;
                }
                if (minY === undefined || y < minY) {
                    minY = y;
                }
                if (maxY === undefined || y > maxY) {
                    maxY = y;
                }
            }
        }
    }   

    const aspectRatio = (maxX - minX) / (maxY - minY);
    const featurePolygonMapWidth = 1024;
    const featurePolygonMapHeight = Math.round(featurePolygonMapWidth / aspectRatio);

    const featurePolygonMap = new Uint32Array(featurePolygonMapWidth * featurePolygonMapHeight);

    const putPolygonInFeaturePolygonMap = (polygonCoords: number[][], featureIndex: number) => {
        const denomX = (maxX - minX) || 1;
        const denomY = (maxY - minY) || 1;

        // Convert polygon coordinates to pixel space once.
        const pixelCoords = new Array(polygonCoords.length);
        let polyMinY = featurePolygonMapHeight - 1;
        let polyMaxY = 0;
        let polyMinX = featurePolygonMapWidth - 1;
        let polyMaxX = 0;
        for (let i = 0; i < polygonCoords.length; i++) {
            const coord = polygonCoords[i];
            const x = Math.floor(((coord[0] as number) - minX) / denomX * featurePolygonMapWidth);
            const y = Math.floor(((coord[1] as number) - minY) / denomY * featurePolygonMapHeight);
            pixelCoords[i] = [x, y];
            if (y < polyMinY) polyMinY = y;
            if (y > polyMaxY) polyMaxY = y;
            if (x < polyMinX) polyMinX = x;
            if (x > polyMaxX) polyMaxX = x;
        }

        // Clamp scanline range to the polygon bounds to avoid extra work.
        polyMinY = Math.max(0, Math.min(featurePolygonMapHeight - 1, polyMinY));
        polyMaxY = Math.max(0, Math.min(featurePolygonMapHeight - 1, polyMaxY));
        if (polyMinY > polyMaxY) return;

        // Minimum-footprint fallback for tiny polygons that collapse to < 1px.
        if (polyMinX === polyMaxX && polyMinY === polyMaxY) {
            const clampedX = Math.max(0, Math.min(featurePolygonMapWidth - 1, polyMinX));
            const clampedY = Math.max(0, Math.min(featurePolygonMapHeight - 1, polyMinY));
            featurePolygonMap[clampedY * featurePolygonMapWidth + clampedX] = featureIndex + 1;
            return;
        }

        // Build edge table for scanline intersection updates.
        type Edge = { yMax: number; x: number; invSlope: number };
        const edgeTable: Edge[][] = Array.from({ length: polyMaxY - polyMinY + 1 }, () => []);

        for (let i = 0; i < pixelCoords.length; i++) {
            const [x1, y1] = pixelCoords[i];
            const [x2, y2] = pixelCoords[(i + 1) % pixelCoords.length];
            if (y1 === y2) continue; // horizontal edge, skip

            let yMin = y1;
            let yMax = y2;
            let xAtYMin = x1;
            if (y1 > y2) {
                yMin = y2;
                yMax = y1;
                xAtYMin = x2;
            }

            if (yMax < polyMinY || yMin > polyMaxY) continue;

            const invSlope = (x2 - x1) / (y2 - y1);
            const bucketIndex = Math.max(0, yMin - polyMinY);
            edgeTable[bucketIndex].push({ yMax, x: xAtYMin, invSlope });
        }

        const activeEdges: Edge[] = [];
        for (let y = polyMinY; y <= polyMaxY; y++) {
            const bucket = edgeTable[y - polyMinY];
            if (bucket.length > 0) {
                for (let i = 0; i < bucket.length; i++) {
                    activeEdges.push(bucket[i]);
                }
            }

            // Remove edges that are no longer active.
            for (let i = activeEdges.length - 1; i >= 0; i--) {
                if (activeEdges[i].yMax <= y) {
                    activeEdges.splice(i, 1);
                }
            }

            if (activeEdges.length < 2) {
                for (let i = 0; i < activeEdges.length; i++) {
                    activeEdges[i].x += activeEdges[i].invSlope;
                }
                continue;
            }

            activeEdges.sort((a, b) => a.x - b.x);

            for (let i = 0; i < activeEdges.length; i += 2) {
                const xStart = Math.floor(activeEdges[i].x);
                const xEnd = Math.floor(activeEdges[i + 1].x);
                if (xEnd <= 0 || xStart >= featurePolygonMapWidth) continue;

                const start = Math.max(0, xStart);
                const end = Math.min(featurePolygonMapWidth, xEnd);
                let offset = y * featurePolygonMapWidth + start;
                const value = featureIndex + 1;
                for (let x = start; x < end; x++) {
                    featurePolygonMap[offset++] = value;
                }
            }

            for (let i = 0; i < activeEdges.length; i++) {
                activeEdges[i].x += activeEdges[i].invSlope;
            }
        }
    }

    const indices: number[] = [];
    const positions: number[] = [];

    let polygonsParsed = 0;
    let featuresSkipped = 0;

    const positionDictionary: { [key: string]: number } = {};
    const lineDictionary: { [key: string]: number } = {};

    const getPositionIndex = (pixelX: number, pixelY: number): number => {
        const newKey = `${pixelX}-${pixelY}`;
        const readPositionNew = positionDictionary[newKey];
        if (readPositionNew !== undefined) {
            return readPositionNew;
        }
        positionDictionary[newKey] = positions.length / 3;
        positions.push(0, pixelY, -pixelX);
        return positions.length / 3 - 1;
    }

    // Creates a line between two points if it doesn't already exist, i.e., merge identical lines in the GeoJSON and represent them as a single line
    const makeLine = (index1: number, index2: number) => {
        const newKey = `${Math.min(index1, index2)}-${Math.max(index1, index2)}`;
        const readlineNew = lineDictionary[newKey];
        if (readlineNew !== undefined) {
            return readlineNew;
        }
        lineDictionary[newKey] = indices.length / 2;
        indices.push(index1, index2);
    }

    const parsePolygon = (polygonCoords: number[][]) => {
        let lastPositionIndex = 0;
        for (let i = 0; i <= polygonCoords.length; i++) {
            const nextPoint = polygonCoords[i % polygonCoords.length];
            const pixelX = nextPoint[0] as number;
            const pixelY = nextPoint[1] as number;
            const thisPositionIndex = getPositionIndex(pixelX, pixelY);
            if (i > 0) {
                makeLine(thisPositionIndex, lastPositionIndex);
            }
            lastPositionIndex = thisPositionIndex;
        }
        polygonsParsed += 1;
    }

    const parsePoint = (pointCoords: number[]) => {
        // make a little diamond
        const pixelX = pointCoords[0] as number;
        const pixelY = pointCoords[1] as number;
        const p = 0.001;
        positions.push(0, pixelY, -pixelX + p);
        positions.push(0, pixelY + p, -pixelX);
        positions.push(0, pixelY, -pixelX - p);
        positions.push(0, pixelY - p, -pixelX);

        const startIndex = indices.length / 2;
        indices.push(startIndex, startIndex + 1);
        indices.push(startIndex + 1, startIndex + 2);
        indices.push(startIndex + 2, startIndex + 3);
        indices.push(startIndex + 3, startIndex);
    }

    const parseLine = (lineCoords: number[][]) => {
        for (let i = 0; i < lineCoords.length - 1; i++) {
            const startCoords = lineCoords[i];
            const endCoords = lineCoords[i + 1];
            const pixelX1 = startCoords[0] as number;
            const pixelY1 = startCoords[1] as number;
            const pixelX2 = endCoords[0] as number;
            const pixelY2 = endCoords[1] as number;
            positions.push(0, pixelY1, -pixelX1);
            positions.push(0, pixelY2, -pixelX2);
            const startIndex = indices.length / 2;
            indices.push(startIndex, startIndex + 1);
        }
    }

    const before = performance.now();
    let featureIndex = 0;
    for (let feature of geoJsonOrUrl.features) {
        if (feature.geometry.type == "MultiPolygon") {
            for (let shape of feature.geometry.coordinates) {
                for (let coords of shape) {
                    parsePolygon(coords as number[][]);
                    putPolygonInFeaturePolygonMap(coords as number[][], featureIndex);
                }
            }
        } else if (feature.geometry.type == "Polygon") {
            const coords = feature.geometry.coordinates[0];
            parsePolygon(coords as number[][]);
            putPolygonInFeaturePolygonMap(coords as number[][], featureIndex);
        } else if (feature.geometry.type == "Point") {
            parsePoint(feature.geometry.coordinates as number[]);
        } else if (feature.geometry.type == "MultiPoint") {
            for (let point of feature.geometry.coordinates) {
                parsePoint(point as number[]);
            }
        } else if (feature.geometry.type == "MultiLineString") {
            for (let line of feature.geometry.coordinates) {
                parseLine(line as number[][]);
            }
        } else if (feature.geometry.type == "LineString") {
            parseLine(feature.geometry.coordinates as number[][]);
        } else {
            featuresSkipped += 1;
        }
        featureIndex += 1;
    }
    
    
    // fill values with are 0 with a neighboring value to ensure that the getFeatureIdFromPolygonFeatureMap function in the shader returns a feature ID for pixels that are just outside the polygon edges, which helps with anti-aliasing and ensures more consistent feature ID retrieval for rays that graze polygon edges
    let emptyPixelsFilled = 0;
    let emptyPixelsNotFilled = 0;
    const maxDistance = 4;
    const sourceFeaturePolygonMap = featurePolygonMap.slice();
    for (let y = 0; y < featurePolygonMapHeight; y++) {
        for (let x = 0; x < featurePolygonMapWidth; x++) {
            const offset = y * featurePolygonMapWidth + x;
            if (sourceFeaturePolygonMap[offset] === 0) {
                // iterate from the pixel to a max distance in a spiral pattern to find the nearest non-zero pixel and fill with that value
                let foundValue = 0;
                for (let d = 1; d <= maxDistance; d++) {
                    for (let dy = -d; dy <= d; dy++) {
                        for (let dx = -d; dx <= d; dx++) {
                            if (Math.abs(dx) !== d || Math.abs(dy) !== d) continue; // only check the outer ring of the spiral for this distance
                            const newX = x + dx;
                            const newY = y + dy;
                            if (newX < 0 || newX >= featurePolygonMapWidth || newY < 0 || newY >= featurePolygonMapHeight) continue;
                            const newOffset = newY * featurePolygonMapWidth + newX;
                            if (sourceFeaturePolygonMap[newOffset] !== 0) {
                                foundValue = sourceFeaturePolygonMap[newOffset];
                                break;
                            }
                        }
                        if (foundValue !== 0) break;
                    }
                    if (foundValue !== 0) {
                        featurePolygonMap[offset] = foundValue;
                        emptyPixelsFilled += 1;
                        break;
                    }
                }
                if (featurePolygonMap[offset] === 0) {
                    emptyPixelsNotFilled += 1;
                }
            }
        }
    }

    const featureIdToProperties: { [featureId: number]: any } = {};
    for (let i = 0; i < geoJsonOrUrl.features.length; i++) {
        featureIdToProperties[i + 1] = geoJsonOrUrl.features[i].properties;
    }

    // console.log(`Feature polygon map: ${emptyPixelsNotFilled} un-filled empty pixels, ${emptyPixelsFilled} filled empty pixels, out of ${featurePolygonMapWidth * featurePolygonMapHeight} total pixels`);
                
    // console.log(`Parsed ${polygonsParsed} polygons and skipped ${featuresSkipped} features in ${(performance.now() - before) / 1000} seconds`);
    
    const lineSegmentMapZ = new FastLineSegmentMap(2, segmentMapBins, positions, indices);
    const lineSegmentMapY = new FastLineSegmentMap(1, segmentMapBins, positions, indices);

    return { indices: indices, positions: positions, lineSegmentMapY, lineSegmentMapZ, featurePolygonMap, geoJsonBounds: { minX, minY, maxX, maxY }, featurePolygonMapWidth, featurePolygonMapHeight, featureIdToProperties };
}

const geoJSONWorkerApi = {
    parseGeoJSON
};

export type GeoJSONWorkerApi = typeof geoJSONWorkerApi;

expose(geoJSONWorkerApi);

