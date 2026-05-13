/**
 * Colormap logic extracted from tiledata.ts
 *
 * This module contains:
 * - ColormapEntry: A single entry in a colormap with value and color
 * - Colormap: Manages colormap data, interpolation, and fast texture generation
 */

import { Color } from 'three';
import { COLORMAP_STEPS } from '../constants';

/**
 * Represents a single entry in a colormap, mapping a normalized value (0-1) to a color.
 */
export class ColormapEntry {
    constructor(value: number, color: Color) {
        this.value = value;
        this.color = color;
    }

    value: number;
    color: Color;
}

/**
 * Manages colormap data and provides color interpolation and fast texture generation.
 * This class handles the pure colormap logic without any external dependencies.
 */
export class Colormap {
    private entries: ColormapEntry[] = [];
    private fastColormap: Uint8Array = new Uint8Array(COLORMAP_STEPS * 4);
    private colorsNotFound: number = 0;
    private _name: string = "";

    /**
     * Gets the current colormap name.
     */
    get name(): string {
        return this._name;
    }

    /**
     * Sets the colormap name.
     */
    set name(value: string) {
        this._name = value;
    }

    /**
     * Gets the number of colors that couldn't be found during interpolation.
     * This is a diagnostic counter that resets when a new colormap is loaded.
     */
    get missedColors(): number {
        return this.colorsNotFound;
    }

    /**
     * Gets the fast colormap texture data as a Uint8Array (RGBA format).
     * This is suitable for uploading to a GPU texture.
     */
    getFastColormapTexture(): Uint8Array {
        return this.fastColormap;
    }

    /**
     * Gets the colormap entries.
     */
    getEntries(): readonly ColormapEntry[] {
        return this.entries;
    }

    /**
     * Sets the colormap from raw data.
     * @param data Array of RGB color values, each as [r, g, b] with values 0-1
     * @param name Optional name for the colormap
     * @returns true if the colormap was set successfully
     */
    setFromData(data: Array<Array<number>>, name?: string): boolean {
        if (!data || data.length < 2) {
            return false;
        }

        this._name = name || "Custom Colormap";
        this.colorsNotFound = 0;
        this.entries.splice(0, this.entries.length);

        for (let i = 0; i < data.length; i++) {
            const p = i / (data.length - 1);
            const c = data[i];
            this.entries.push(new ColormapEntry(p, new Color().setRGB(c[0], c[1], c[2])));
        }

        this.updateFastColormap();
        return true;
    }

    /**
     * Gets the interpolated color at a normalized position (0-1) in the colormap.
     * @param p Normalized position (0-1)
     * @returns The interpolated color
     */
    getColorAt(p: number): Color {
        const colors = this.entries;

        if (colors.length === 0) {
            this.colorsNotFound++;
            return new Color("white");
        }

        // Clamp p to valid range
        p = Math.max(0, Math.min(1, p));
        
        for (let i = 0; i < colors.length - 1; i++) {
            const previous = colors[i];
            const next = colors[i + 1];
            
            if (previous.value <= p && next.value >= p) {
                const t = (p - previous.value) / (next.value - previous.value);
                const lerped = new Color().lerpColors(previous.color, next.color, t);
                return lerped;
            }
        }

        // Fallback: return last color if p is at the end
        if (p >= 1 && colors.length > 0) {
            return colors[colors.length - 1].color.clone();
        }

        this.colorsNotFound++;
        return new Color("white");
    }

    /**
     * Updates the fast colormap texture from the current colormap entries.
     * This should be called after any changes to the colormap.
     */
    updateFastColormap(): void {
        for (let i = 0; i <= COLORMAP_STEPS; i++) {
            const col = this.getColorAt(i * 1.0 / COLORMAP_STEPS);
            this.fastColormap[i * 4 + 0] = col.r; // R channel encodes position
            this.fastColormap[i * 4 + 1] = col.g;
            this.fastColormap[i * 4 + 2] = col.b;
            this.fastColormap[i * 4 + 3] = 255;
        }
    }

    /**
     * Checks if the colormap has any entries.
     */
    isEmpty(): boolean {
        return this.entries.length === 0;
    }

    /**
     * Gets the number of entries in the colormap.
     */
    get length(): number {
        return this.entries.length;
    }
}
