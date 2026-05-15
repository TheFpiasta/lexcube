export class DataValue {
    value: number | Uint8Array;
    isDataNan: boolean | boolean[];
    isDataNotLoaded: boolean;

    constructor(v: { value: number | Uint8Array, isDataNan: boolean | boolean[], isDataNotLoaded: boolean }) {
        this.value = v.value;
        this.isDataNan = v.isDataNan;
        this.isDataNotLoaded = v.isDataNotLoaded;
    }
}

export class StorageUsage {
    cpuSideBytes: number;
    gpuSideBytes: number;

    constructor(cpuSideBytes: number, gpuSideBytes: number) {
        this.cpuSideBytes = cpuSideBytes;
        this.gpuSideBytes = gpuSideBytes;
    }

    static sum(usages: StorageUsage[]): StorageUsage {
        const totalCpuSideBytes = usages.reduce((sum, usage) => sum + usage.cpuSideBytes, 0);
        const totalGpuSideBytes = usages.reduce((sum, usage) => sum + usage.gpuSideBytes, 0);
        return new StorageUsage(totalCpuSideBytes, totalGpuSideBytes);
    }
}
