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

// AsyncPickRing: GPU picking with PIXEL_PACK_BUFFER + fenceSync ring.
// - Non-stalling: never waits; you "submit" a pick and "poll" later.

import { NearestFilter, RGBAIntegerFormat, UnsignedIntType, Vector4, WebGLRenderer, WebGLRenderTarget } from "three";

class AsyncPickRing {
    private renderer: WebGLRenderer;
    private gl: WebGL2RenderingContext
    private ringSize: number;
    private pickTarget: WebGLRenderTarget;
    private entries: {
        pbo: WebGLBuffer;
        sync: WebGLSync | null;
        pending: boolean;
        cpu: Uint32Array;
        requestId: number;
    }[];
    private writeIndex: number;
    private nextRequestId: number;
    private drawPickPass: () => void;

    constructor(renderer: WebGLRenderer, drawPickPass: () => void, ringSize = 4) {
        this.renderer = renderer;
        this.gl = renderer.getContext() as WebGL2RenderingContext;
        this.ringSize = ringSize;
        this.drawPickPass = drawPickPass;

        const gl = this.gl;
        if (!(gl instanceof WebGL2RenderingContext)) {
            throw new Error("Requires WebGL2");
        }

        // 1x1 RGBA32UI pick target (simple + widely supported for ID encoding).
        this.pickTarget = new WebGLRenderTarget(1, 1, {
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            format: RGBAIntegerFormat,
            type: UnsignedIntType,
            depthBuffer: false,
            stencilBuffer: false,
            generateMipmaps: false,
        });
        this.pickTarget.texture.internalFormat = "RGBA32UI";
        this.pickTarget.texture.generateMipmaps = false;

        // Ring entries: PBO + fence + result staging + metadata
        this.entries = new Array(ringSize).fill(0).map(() => {
            const pbo = gl.createBuffer()!;
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
            gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ); // 1x1 RGBA32UI = 16 bytes
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

            return {
                pbo,
                sync: null,
                pending: false,
                // CPU-side buffer where getBufferSubData copies once fence signals
                cpu: new Uint32Array(4),
                // You can store mouse coords, frame index, etc.
                requestId: 0,
            };
        });

        this.writeIndex = 0;
        this.nextRequestId = 1;
    }

    dispose() {
        const gl = this.gl;
        for (const e of this.entries) {
            if (e.sync) gl.deleteSync(e.sync);
            gl.deleteBuffer(e.pbo);
        }
        this.pickTarget.dispose();
    }

    // Submit a pick. This does NOT block and does NOT return the result immediately.
    // drawPickPass() should render your "ID output" shader into the currently bound FBO.
    // For voxel DDA volume picking: output the hit voxel coord / linear index encoded into RGBA8.
    requestPickRender() {
        const gl = this.gl;
        // Find next free slot (non-pending). If none, drop this request.
        let slotIndex = this.writeIndex;
        let found = false;
        for (let i = 0; i < this.ringSize; i++) {
            const idx = (this.writeIndex + i) % this.ringSize;
            if (!this.entries[idx].pending) {
                slotIndex = idx;
                found = true;
                break;
            }
        }
        if (!found) return 0;

        const e = this.entries[slotIndex];

        // Render pick pass into 1x1 target.
        const prevTarget = this.renderer.getRenderTarget();
        const prevViewport = this.renderer.getViewport(new Vector4());
        this.renderer.setRenderTarget(this.pickTarget);
        this.renderer.setViewport(0, 0, 1, 1);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DITHER);
        gl.disable(gl.BLEND);

        gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));

        const prevAutoClear = this.renderer.autoClear;
        this.renderer.autoClear = false; // prevent non-int auto-clearing leading to errors
        this.drawPickPass();
        this.renderer.autoClear = prevAutoClear;

        // Enqueue async readback into this slot's PBO.
        // Orphan the buffer to avoid READ-usage shadow-copy warnings on some drivers.
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
        gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        // Fence after readPixels so we can test readiness later.
        if (e.sync) gl.deleteSync(e.sync);
        e.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);

        gl.flush();

        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setViewport(prevViewport);

        e.pending = true;
        e.requestId = this.nextRequestId++;

        this.writeIndex = (slotIndex + 1) % this.ringSize;
        return e.requestId;
    }

    // Poll for any completed pick results.
    // Returns an array of { requestId, rgba, id } for each completed entry.
    poll() {
        const gl = this.gl;
        const done = [];

        for (const e of this.entries) {
            if (!e.pending || !e.sync) continue;

            // Non-blocking check: timeout = 0 so we never stall.
            const res = gl.clientWaitSync(e.sync, 0, 0);

            if (res === gl.WAIT_FAILED) {
                // Treat as failed; clear pending to avoid deadlock.
                gl.deleteSync(e.sync);
                e.sync = null;
                e.pending = false;
                continue;
            }

            if (res === gl.TIMEOUT_EXPIRED) {
                continue; // not ready yet
            }

            // Ready: copy 16 bytes from PBO into cpu Uint32Array
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, e.cpu);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

            gl.deleteSync(e.sync);
            e.sync = null;
            e.pending = false;

            const x = e.cpu[0] >>> 0;
            const y = e.cpu[1] >>> 0;
            const z = e.cpu[2] >>> 0;
            const hit = (e.cpu[3] >>> 0) !== 0;
            const featureId = hit ? (e.cpu[3] >>> 0) - 1 : -1; // treat 0 as "no hit", so subtract 1 to get original ID

            done.push({ requestId: e.requestId, hit, featureId, x, y, z });
        }

        return done;
    }
}

export { AsyncPickRing };