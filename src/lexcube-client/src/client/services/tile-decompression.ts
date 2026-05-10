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

import { Blosc, LZ4, ZFP } from 'numcodecs';
import {
    LOSSLESS_TILE_MAGIC_NUMBER,
    NAN_TILE_MAGIC_NUMBER,
    TILE_FORMAT_MAGIC_BYTES,
    TILE_VERSION,
    TILE_VERSION_3D,
    TILE_VERSION_FLAG_FLOAT32,
    TILE_VERSION_FLAG_FLOAT64,
    TILE_VERSION_FLAG_RGB_UINT8,
    TILE_VERSION_MASK,
} from '../constants';
import { Tile2D, Tile3D } from '../core/tiles';

export interface DecompressedTileResult {
    validTile: boolean;
    isNanTile?: boolean;
    tileData?: Uint8Array;
    nanOrQuantileMask?: Uint8Array;
    resampleResolution?: number;
    tileMin?: number;
    tileMax?: number;
    tileMean?: number;
    tileVariance?: number;
    lossless?: boolean;
    maxError?: number;
    releaseBuffer?: () => void;
    expectedDtype?: typeof Float32Array | typeof Float64Array | typeof Uint8Array;
}

export class TileDecompressor {
    private lz4Codec = LZ4.fromConfig({ id: 'lz4' });
    private bloscCodec = Blosc.fromConfig({ id: 'blosc' });
    private zfpCodec = ZFP.fromConfig({ id: 'zfp' });

    /**
     * Parse tile header, validate format, and decompress data.
     * Returns the parsed/decompressed result or null if header validation fails.
     */
    async decompressTile(
        tile: Tile2D | Tile3D,
        data: ArrayBuffer,
        debugMode: boolean = false
    ): Promise<DecompressedTileResult> {
        const is2d = tile instanceof Tile2D;
        const is3d = tile instanceof Tile3D;

        // Validate magic bytes
        const magic_bytes = new Uint8Array(data, 0, 4);
        if (TILE_FORMAT_MAGIC_BYTES !== String.fromCharCode(...magic_bytes)) {
            console.error('Received tile has invalid magic bytes');
            return { validTile: false };
        }

        // Validate version and flags
        const tile_version_and_flags = new Uint32Array(data, 4, 1)[0];
        const tile_version = tile_version_and_flags & TILE_VERSION_MASK;
        if ((is2d && tile_version !== TILE_VERSION) || (is3d && tile_version !== TILE_VERSION_3D)) {
            console.error(
                'Received tile has invalid tile version:',
                tile_version,
                'Expected:',
                is2d ? TILE_VERSION : TILE_VERSION_3D
            );
            return { validTile: false };
        }

        let expectedDtype: typeof Float32Array | typeof Float64Array | typeof Uint8Array | null =
            tile_version_and_flags & TILE_VERSION_FLAG_FLOAT32
                ? Float32Array
                : tile_version_and_flags & TILE_VERSION_FLAG_FLOAT64
                ? Float64Array
                : tile_version_and_flags & TILE_VERSION_FLAG_RGB_UINT8
                ? Uint8Array
                : null;

        if (tile_version_and_flags == tile_version) {
            if (debugMode) {
                console.warn(
                    'Legacy tiles without data type flag received, assuming Float64-ZFP-encoded and Float32 when decoded'
                );
            }
            expectedDtype = Float32Array;
        } else if (!expectedDtype) {
            console.error(
                'Received tile has invalid or unsupported data type flag in tile version and flags:',
                tile_version_and_flags
            );
            return { validTile: false };
        }

        const maxErrorOrMagicNumber = new Float64Array(data, 16, 1)[0];

        // NaN tile
        if (maxErrorOrMagicNumber == NAN_TILE_MAGIC_NUMBER) {
            return { validTile: true, isNanTile: true };
        }

        // Parse header fields
        const resampleResolution = new Uint32Array(data, 8, 1)[0];
        const nanOrQuantileMaskHeaderLength = new Uint32Array(data, 12, 1)[0];
        const tileMin = new Float64Array(data, 24, 1)[0];
        const tileMax = new Float64Array(data, 32, 1)[0];
        const tileMean = new Float64Array(data, 40, 1)[0];
        const tileVariance = new Float64Array(data, 48, 1)[0];
        const nanOrQuantileMaskHeaderBytes = new Uint8Array(
            data,
            56,
            nanOrQuantileMaskHeaderLength
        );
        const tileDataBytes = new Uint8Array(data, 56 + nanOrQuantileMaskHeaderLength);

        const lossless = maxErrorOrMagicNumber == LOSSLESS_TILE_MAGIC_NUMBER;
        const maxError = lossless ? 0 : maxErrorOrMagicNumber;

        let tileData: Uint8Array;
        let nanOrQuantileMask: Uint8Array | undefined;

        if (lossless) {
            if (is3d) {
                const result = await Promise.all([
                    this.lz4Codec.decode(nanOrQuantileMaskHeaderBytes),
                    this.bloscCodec.decode(tileDataBytes),
                ]);
                nanOrQuantileMask = result[0] as Uint8Array;
                tileData = result[1] as Uint8Array;
            } else {
                tileData = (await this.bloscCodec.decode(tileDataBytes)) as Uint8Array;
            }
        } else {
            const result = await Promise.all([
                this.lz4Codec.decode(nanOrQuantileMaskHeaderBytes),
                is3d ? this.zfpCodec.decode3d(tileDataBytes) : this.zfpCodec.decode(tileDataBytes),
            ]);
            nanOrQuantileMask = result[0] as Uint8Array;
            tileData = result[1] as Uint8Array;
        }

        return {
            validTile: true,
            isNanTile: false,
            tileData,
            nanOrQuantileMask,
            resampleResolution,
            tileMin,
            tileMax,
            tileMean,
            tileVariance,
            lossless,
            maxError,
            expectedDtype: expectedDtype!,
        };
    }
}
