import {
    Texture, RedFormat, FloatType, NearestFilter, ClampToEdgeWrapping, RGBAFormat,
    UnsignedByteType, Data3DTexture, DataTexture, HalfFloatType, LinearMipMapLinearFilter
} from 'three';
import {
    CubeFace, FLOAT_NAN_REPLACEMENT_VALUE, FLOAT_NOT_LOADED_REPLACEMENT_VALUE, TILE_SIZE_2D, TILE_SIZE_3D,
    RGB_NOT_LOADED_ALPHA_VALUE, DataType, NON_EXTREME_QUANTILE_INDEX, TILES_TEXTURE_NAME,
    HALF_FLOAT_NAN_REPLACEMENT_VALUE, HALF_FLOAT_NOT_LOADED_REPLACEMENT_VALUE
} from '../../../constants';
import { CubeClientContext } from '../../../client';
import { StorageUsage } from './types';
import type { TileStorage } from '.';

export class TileStorageAllocator {
    private context: CubeClientContext;
    private host: TileStorage;

    constructor(context: CubeClientContext, host: TileStorage) {
        this.context = context;
        this.host = host;
    }

    allocateTile2dStorages(forceStorageRecreation: boolean = false) {
        const storage = this.host.dataType == DataType.RGB ? this.host.tileStoragesRgb : this.host.tile2dStoragesFloat;
        if (!forceStorageRecreation && storage && storage.length > 1) {
            const notLoadedValue = this.host.dataType == DataType.RGB ? RGB_NOT_LOADED_ALPHA_VALUE : FLOAT_NOT_LOADED_REPLACEMENT_VALUE;
            for (const faceStorage of storage) {
                for (const lodStorage of faceStorage) {
                    lodStorage.fill(notLoadedValue);
                }
            }
            for (let face = 0; face < 6; face++) {
                const material = this.context.rendering.tile2dFaceRenderedCube.material[face];
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value.needsUpdate = true;
                }
            }
            this.context.log("Recycled existing textures and float32/uint8 arrays");
            return;
        }
        this.host.tile2dStoragesFloat = [];
        this.host.tileStoragesRgb = [];
        if (this.host.dataType == DataType.Float) {
            for (let face = 0; face < 6; face++) {
                this.host.tile2dStoragesFloat.push([]);
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    this.host.tile2dStoragesFloat[face].push(new Float32Array(0));
                }
            }
        } else if (this.host.dataType == DataType.RGB) {
            for (let face = 0; face < 6; face++) {
                this.host.tileStoragesRgb.push([]);
                for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                    this.host.tileStoragesRgb[face].push(new Uint8Array(0));
                }
            }
        }
        this.host.tile2dStoragesAllocated = new Set<string>();
        this.host.totalBytesAllocatedFor2d = 0;
        this.context.log(`Reset tile storages`);
    }

    allocateTile3dStorages(forceStorageRecreation: boolean = false) {
        if (!forceStorageRecreation && this.host.tile3dStoragesFloat && this.host.tile3dStoragesFloat.length > 1) {
            const currentTextureUsesHalfFloat = this.host.tile3dStoragesFloat[0] instanceof Uint16Array;
            if (currentTextureUsesHalfFloat == this.host.useHalfFloatsForTile3d) {
                const notLoadedValue = this.host.useHalfFloatsForTile3d ? HALF_FLOAT_NOT_LOADED_REPLACEMENT_VALUE : FLOAT_NOT_LOADED_REPLACEMENT_VALUE;
                for (const lodStorage of this.host.tile3dStoragesFloat) {
                    lodStorage.fill(notLoadedValue);
                }
                for (const quantileAndNanFactorStorage of this.host.tile3dQuantileIndexStorages) {
                    quantileAndNanFactorStorage.fill(NON_EXTREME_QUANTILE_INDEX);
                }
                const material = this.context.rendering.tile3dVolumeRenderedCube.material;
                for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
                    material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value.needsUpdate = true;
                }
                this.context.log("Recycled existing textures and float32/uint8 arrays");
                return;
            }
        }
        this.host.tile3dStoragesFloat = [];
        this.host.tile3dQuantileIndexStorages = [];
        for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
            this.host.tile3dStoragesFloat.push(this.host.useHalfFloatsForTile3d ? new Uint16Array(0) : new Float32Array(0));
            this.host.tile3dQuantileIndexStorages.push(new Uint8Array(0));
        }
        this.host.storages3dAllocated = new Set<string>();
        this.host.totalBytesAllocatedFor3d = 0;
        this.context.log(`Reset tile storages`);
    }

    allocateTexture2d(face: CubeFace, lod: number) {
        const key = `2d-${face}-${lod}`;
        if (this.host.tile2dStoragesAllocated.has(key)) {
            return;
        }
        this.host.tile2dStoragesAllocated.add(key);

        const material = this.context.rendering.tile2dFaceRenderedCube.material[face];
        if (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value) {
            (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value as Texture).dispose();
        }
        const ttvSizeInTiles = this.context.rendering.getTileTextureView2dSizeInTiles(face, lod);

        const totalTiles = ttvSizeInTiles.x * ttvSizeInTiles.y;
        const totalValues = (TILE_SIZE_2D * TILE_SIZE_2D) * totalTiles;
        const totalBytes = 4 * totalValues;
        if (this.host.dataType == DataType.RGB) {
            this.host.tileStoragesRgb[face][lod] = new Uint8Array(totalValues * 4);
            this.host.tileStoragesRgb[face][lod].fill(RGB_NOT_LOADED_ALPHA_VALUE);
        } else if (this.host.dataType == DataType.Float) {
            this.host.tile2dStoragesFloat[face][lod] = new Float32Array(totalValues);
            this.host.tile2dStoragesFloat[face][lod].fill(FLOAT_NOT_LOADED_REPLACEMENT_VALUE);
        }
        const storage = this.host.dataType == DataType.RGB ? this.host.tileStoragesRgb[face][lod] : this.host.tile2dStoragesFloat[face][lod];

        const texture = new DataTexture(storage, TILE_SIZE_2D * ttvSizeInTiles.x, TILE_SIZE_2D * ttvSizeInTiles.y);

        if (this.host.dataType == DataType.RGB) {
            texture.format = RGBAFormat;
            texture.type = UnsignedByteType;
        } else if (this.host.dataType == DataType.Float) {
            texture.format = RedFormat;
            texture.type = FloatType;
        }

        texture.name = `${TILES_TEXTURE_NAME}${lod}Face${face}`;
        texture.generateMipmaps = this.host.textureFilteringEnabled;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.magFilter = NearestFilter;
        texture.minFilter = this.host.textureFilteringEnabled ? LinearMipMapLinearFilter : NearestFilter;
        texture.anisotropy = this.host.textureFilteringEnabled ? 8 : 1;

        this.context.log("Creating texture with minFilter: ", texture.minFilter == NearestFilter ? "NearestFilter" : "LinearMipMapLinearFilter", "and anisotropy:", texture.anisotropy);
        material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value = texture;
        this.host.totalBytesAllocatedFor2d += totalBytes;
        this.context.log(`Allocated CPU-side tile storage for face ${CubeFace[face]}, LoD ${lod} (new: ${totalBytes / (1024 * 1024)} MB, total for 2D tiles: ${this.host.totalBytesAllocatedFor2d / (1024 * 1024)} MB)`);
    }

    allocateTexture3d(lod: number) {
        const key = `3d-${lod}`;
        if (this.host.storages3dAllocated.has(key)) {
            return;
        }
        this.host.storages3dAllocated.add(key);

        const material = this.context.rendering.tile3dVolumeRenderedCube.material;
        if (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value) {
            (material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value as Texture).dispose();
        }
        const totalTiles = this.context.rendering.getTileTextureView3dSize(lod);
        const totalValues = (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) * totalTiles.x * totalTiles.y * totalTiles.z;
        this.host.tile3dStoragesFloat[lod] = this.host.useHalfFloatsForTile3d ? new Uint16Array(totalValues) : new Float32Array(totalValues);
        this.host.tile3dStoragesFloat[lod].fill(this.host.useHalfFloatsForTile3d ? HALF_FLOAT_NAN_REPLACEMENT_VALUE : FLOAT_NAN_REPLACEMENT_VALUE);
        this.host.tile3dQuantileIndexStorages[lod] = new Uint8Array(totalValues);
        this.host.tile3dQuantileIndexStorages[lod].fill(NON_EXTREME_QUANTILE_INDEX);

        const dataTexture = new Data3DTexture(this.host.tile3dStoragesFloat[lod], totalTiles.x * TILE_SIZE_3D, totalTiles.y * TILE_SIZE_3D, totalTiles.z * TILE_SIZE_3D);
        this.context.log("AllocateTexture3D: 3d texture size", totalTiles.x * TILE_SIZE_3D, totalTiles.y * TILE_SIZE_3D, totalTiles.z * TILE_SIZE_3D, "with type", this.host.useHalfFloatsForTile3d ? "HalfFloatType" : "FloatType", ", element count", this.host.tile3dStoragesFloat[lod].length, "xtiles", totalTiles.x, "ytiles", totalTiles.y, "ztiles", totalTiles.z);
        dataTexture.format = RedFormat;
        dataTexture.type = this.host.useHalfFloatsForTile3d ? HalfFloatType : FloatType;
        dataTexture.minFilter = NearestFilter;
        dataTexture.magFilter = NearestFilter;
        material.uniforms[`${TILES_TEXTURE_NAME}${lod}`].value = dataTexture;

        const totalBytes = (this.host.useHalfFloatsForTile3d ? 2 : 4) * totalValues + 2 * totalValues;
        this.host.totalBytesAllocatedFor3d += totalBytes;
        this.context.log(`Allocated CPU-side 3D tile storage for LoD ${lod} (new: ${totalBytes / (1024 * 1024)} MB, total for 3D tiles: ${this.host.totalBytesAllocatedFor3d / (1024 * 1024)} MB)`);
    }

    isTexture3dAllocated(lod: number): boolean {
        const key = `3d-${lod}`;
        return this.host.storages3dAllocated.has(key);
    }

    get3dStorageType(): string {
        return this.host.useHalfFloatsForTile3d ? "float16" : "float32";
    }

    getActual3dStorageSizeOfLodInBytes(): StorageUsage {
        const usages = [];
        for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
            if (this.isTexture3dAllocated(lod)) {
                usages.push(this.getTheoretical3dStorageSizeOfLodInBytes(lod));
            }
        }
        return StorageUsage.sum(usages);
    }

    getTheoretical3dStorageSizeOfLodInBytes(lod: number): StorageUsage {
        const totalTiles = this.context.rendering.getTileTextureView3dSize(lod);
        const totalValues = (TILE_SIZE_3D * TILE_SIZE_3D * TILE_SIZE_3D) * totalTiles.x * totalTiles.y * totalTiles.z;
        const totalBytesForValueStorage = (this.host.useHalfFloatsForTile3d ? 2 : 4) * totalValues;
        const totalBytesForQuantileIndexAndNanFactorMaskStorage = 2 * totalValues;
        return new StorageUsage(totalBytesForValueStorage + totalBytesForQuantileIndexAndNanFactorMaskStorage, totalBytesForValueStorage);
    }
}
