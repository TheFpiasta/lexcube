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

import { toCanvas, getFontEmbedCSS } from 'html-to-image';
import { ArrayBufferTarget as WebmArrayBufferTarget, Muxer as WebmMuxer } from 'webm-muxer'
import { ArrayBufferTarget as Mp4ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer'
import { Encoder as GifEncoder } from 'modern-gif'


enum RecordingFileFormat {
    MP4 = 0,
    WebM = 1,
    GIF = 2,
}

interface FixedFrameCanvasRecorder {
    startCapture(log: (...params: any[]) => void, filename: string): void;
    recordFrame(lastFrame: boolean): Promise<void>;
    requestFinishCapture(postDownload: () => void): Promise<void>;
}

class FixedFrameGifCanvasRecorder implements FixedFrameCanvasRecorder {
    private width: number;
    private height: number;
    private filename: string = "";
    private fps: number;

    private canvas: HTMLCanvasElement;

    private htmlParent: HTMLElement;
    private requestedFinish: boolean;
    private framesReceived: number;
    private htmlNodeFilterFunction: ((domNode: HTMLElement) => boolean) | undefined;
    private fontEmbedCSS: string | undefined;

    private encoder: GifEncoder;

    constructor(htmlParent: HTMLElement, canvas: HTMLCanvasElement, filterFunction: (e: HTMLElement) => boolean, recordingFileFormat: RecordingFileFormat, fps: number) {
        this.requestedFinish = false;
        this.framesReceived = 0;
        this.htmlNodeFilterFunction = filterFunction;
        this.htmlParent = htmlParent;
        this.fps = fps;
        this.canvas = canvas.cloneNode() as HTMLCanvasElement;

        const maxSize = 1920 * 1080;
        if (this.canvas.width * this.canvas.height > maxSize) {
            const scale = Math.sqrt(maxSize / (this.canvas.width * this.canvas.height));
            this.canvas.width = Math.round(this.canvas.width * scale);
            this.canvas.height = Math.round(this.canvas.height * scale);
        }

        this.width = this.canvas.width;
        this.height = this.canvas.height;

        this.encoder = new GifEncoder({
            height: this.height,
            width: this.width
        });
    }

    async startCapture(log: (...params: any[]) => void, filename: string) {
        this.filename = filename;
        this.fontEmbedCSS = await getFontEmbedCSS(this.htmlParent);
    }

    async recordFrame(lastFrame: boolean) {
        if (this.requestedFinish) {
            return;
        }
        const frameId = this.framesReceived;
        this.framesReceived += 1;

        const newCanvas = await toCanvas(this.htmlParent, { "filter": this.htmlNodeFilterFunction, fontEmbedCSS: this.fontEmbedCSS, "style": { backgroundColor: "black" } });

        await this.encoder.encode({ data: newCanvas, delay: 1000 / this.fps });
        newCanvas.remove();
    }

    async requestFinishCapture(postDownload: () => void) {
        this.requestedFinish = true;
        window.setTimeout(async () => {
            await this.finishCapture();
            postDownload();
        }, 1);
    }

    private async finishCapture() {
        const gifBlob = await this.encoder.flush("blob");
        this.download(gifBlob, this.filename);
    }

    private download(gifBlob: Blob, filename: string) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(gifBlob);
        a.download = `${filename}.gif`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => {
            URL.revokeObjectURL(a.href);
        }, 60000); // revoke video blob after 60 seconds
    }
}

// adapted from https://github.com/w3c/mediacapture-record/issues/213#issuecomment-1430325280
class FixedFrameVideoEncoderCanvasRecorder implements FixedFrameCanvasRecorder {
    private fps: number;
    private width: number;
    private height: number;
    private bitrate: number;
    private videoEncoder!: VideoEncoder;
    private reader!: ReadableStreamDefaultReader<VideoFrame>;

    private webmMuxer!: WebmMuxer<WebmArrayBufferTarget>;
    private mp4Muxer!: Mp4Muxer<Mp4ArrayBufferTarget>;

    private framesReceived = 0;
    private framesEncoded: number = 0;

    private webmTarget!: WebmArrayBufferTarget;
    private mp4Target!: Mp4ArrayBufferTarget;

    private track!: MediaStreamTrack;
    private canvas!: HTMLCanvasElement;
    private htmlNodeFilterFunction: (e: HTMLElement) => boolean;
    private htmlParent: HTMLElement;
    private requestedFinish: boolean = false;

    private recordingFileFormat: RecordingFileFormat;
    private fontEmbedCSS: string | undefined;

    private captureFinished: boolean = false;
    private postDownload: (() => void) | undefined = undefined;

    private filename: string = "lexcube-animation";

    constructor(htmlParent: HTMLElement, canvas: HTMLCanvasElement, filterFunction: (e: HTMLElement) => boolean, recordingFileFormat: RecordingFileFormat, fps: number) {
        this.htmlParent = htmlParent;
        this.canvas = canvas.cloneNode() as HTMLCanvasElement;
        this.htmlNodeFilterFunction = filterFunction;
        this.fps = fps;
        this.recordingFileFormat = recordingFileFormat;
        // round up width to next even number
        this.width = Math.ceil(canvas.width / 2) * 2;
        this.height = Math.ceil(canvas.height / 2) * 2;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        // calculate bitrate based on resolution
        this.bitrate = this.width * this.height * 6 * this.fps / 10; // 22.1 Mbs for 1440p
    }

    private async finishEncoding() {
        await this.videoEncoder.flush();
        this.getMuxer().finalize();
        try {
            this.reader.releaseLock();
        } catch (e) {
            console.error(e);
        }
    }

    private async encodeFrame(frame: VideoFrame, repeatFrame: number = 0) {
        const keyFrame = this.framesReceived % 10 === 0; // keyframe every 10 frames
        this.videoEncoder.encode(frame, { keyFrame });
        if (repeatFrame > 0) {
            for (let i = 0; i < repeatFrame; i++) {
                this.videoEncoder.encode(frame, { keyFrame: false });
            }
        }
        frame.close();
    }

    private getMuxer() {
        return this.recordingFileFormat == RecordingFileFormat.MP4 ? this.mp4Muxer : this.webmMuxer;
    }

    async startCapture(log: (...params: any[]) => void, filename: string) {
        this.filename = filename;
        this.videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                this.getMuxer().addVideoChunk(chunk, meta, this.framesEncoded * 1e6 / this.fps);
                this.framesEncoded += 1;
                if (this.requestedFinish && this.framesEncoded == this.framesReceived) { // bug: does not consider repeatFrame
                    this.finishCapture();
                }
            },
            error: (e) => console.error(e),
        });


        const possibleWebmCodecs = new Map<string, string>([['V_AV1', 'av01.0.05M.08'], ['V_VP9', 'vp09.00.10.08'], ['V_VP8', 'vp8']]);
        const possibleMp4Codecs = new Map<string, string>([['avc', 'avc1.420033'], ['hevc', 'hvc1.1.6.L93.90'], ['vp9', 'vp09.00.10.08'], ['av1', 'av01.0.05M.08']]);
        const possibleMp4CodecIds = ["avc", "hevc", "vp9", "av1"] as const;
        let chosenCodecId = "";

        if (this.recordingFileFormat == RecordingFileFormat.MP4) {
            log(`[Recording Setup] Testing MP4 codecs`);
            for (let [codecId, codecString] of possibleMp4Codecs) {
                const config = {
                    codec: codecString,
                    width: this.width,
                    height: this.height,
                    bitrate: this.bitrate,
                    bitrateMode: "constant"
                };

                if ((await VideoEncoder.isConfigSupported(config as any)).supported) {
                    this.videoEncoder.configure(config as any);
                    chosenCodecId = codecId;
                    log(`[Recording Setup] Chose codec ${codecId} & MP4`);
                    break;
                }
            }
        }

        if (this.recordingFileFormat == RecordingFileFormat.WebM) {
            log("[Recording Setup] Testing WebM codecs");
            for (let [codecId, codecString] of possibleWebmCodecs) {
                const config = {
                    codec: codecString,
                    width: this.width,
                    height: this.height,
                    bitrate: this.bitrate,
                    bitrateMode: "constant"
                };

                if ((await VideoEncoder.isConfigSupported(config as any)).supported) {
                    this.videoEncoder.configure(config as any);
                    chosenCodecId = codecId;
                    log(`[Recording Setup] Chose codec ${codecId} & WebM`);
                    break;
                }
            }
        }

        if (chosenCodecId == "") {
            log(`[Recording Setup] No supported codec found`);
            throw new Error("No supported codec found");
        }

        if (this.recordingFileFormat == RecordingFileFormat.MP4) {
            this.mp4Target = new Mp4ArrayBufferTarget();
            this.mp4Muxer = new Mp4Muxer({
                target: this.mp4Target,
                fastStart: "in-memory",
                video: {
                    codec: possibleMp4CodecIds.find((id) => id == chosenCodecId) || "avc",
                    width: this.width,
                    height: this.height,
                    frameRate: this.fps
                },
            });
        } else {
            this.webmTarget = new WebmArrayBufferTarget();
            this.webmMuxer = new WebmMuxer({
                target: this.webmTarget,
                video: {
                    codec: chosenCodecId,
                    width: this.width,
                    height: this.height,
                    frameRate: this.fps,
                },
            });
        }

        this.fontEmbedCSS = await getFontEmbedCSS(this.htmlParent);

        const ctx = this.canvas.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.clearRect(0, 0, this.width, this.height);

        this.track = this.canvas.captureStream(0).getVideoTracks()[0];
        // @ts-expect-error
        const mediaProcessor = new MediaStreamTrackProcessor(this.track); // does not work on firefox, oops
        this.reader = mediaProcessor.readable.getReader();

        // @ts-expect-error
        this.track.requestFrame(); // fix black frames at start
        (await this.reader.read()).value?.close(); // flush the first frame
    }

    async recordFrame(lastFrame: boolean = false) {
        if (this.requestedFinish) {
            return;
        }
        const frameId = this.framesReceived;
        this.framesReceived += 1;

        const newCanvas = await toCanvas(this.htmlParent, { "filter": this.htmlNodeFilterFunction, fontEmbedCSS: this.fontEmbedCSS, "style": { backgroundColor: "black" } });
        const ctx = this.canvas.getContext('2d')!;
        ctx.drawImage(newCanvas, 0, 0, this.canvas.width, this.canvas.height);
        newCanvas.remove();
        // ctx.fillStyle = 'white';
        // ctx.font = '50px sans-serif';
        // ctx.fillText(`Frame ${frameId}`, 10, 50);

        // @ts-expect-error
        this.track.requestFrame();
        const result = await this.reader.read();
        const frame = result.value;
        await this.encodeFrame(frame!, lastFrame ? 1 : 0); // encode last frame twice to make sure it's visible - bug: this does not happen when animation is manually stopped
        frame?.close();
    }

    private getTarget() {
        return this.recordingFileFormat == RecordingFileFormat.MP4 ? this.mp4Target : this.webmTarget;
    }

    private download(filename: string) {
        const format = this.recordingFileFormat == RecordingFileFormat.MP4 ? "mp4" : "webm";
        const a = document.createElement('a');
        const blob = new Blob([this.getTarget().buffer], { type: `video/${format}` });
        a.href = URL.createObjectURL(blob);
        a.download = `${filename}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => {
            URL.revokeObjectURL(a.href);
        }, 60000); // revoke video blob after 60 seconds
    }

    async requestFinishCapture(postDownload: () => void) {
        this.requestedFinish = true;
        this.postDownload = postDownload;
        window.setTimeout(async () => {
            await this.finishCapture(); // as a safeguard for the race condition going on with receiving vs encoding frames
        }, 1500);
    }


    private async finishCapture() {
        if (this.captureFinished) {
            return;
        }
        this.captureFinished = true;
        if (this.framesEncoded == 0) {
            return this.postDownload!();
        }
        await this.finishEncoding();
        this.download(this.filename);
        this.postDownload!();
    }
}

export { RecordingFileFormat, FixedFrameCanvasRecorder, FixedFrameGifCanvasRecorder, FixedFrameVideoEncoderCanvasRecorder }
