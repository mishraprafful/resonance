// Perceptual colormaps: t in [0,1] -> [r,g,b]. Used to recolor grayscale spectrogram magnitudes
// and to draw the colormap swatches in the Tweaks panel and focus viewer.
import type { ColormapName } from "./theme";

type RGB = [number, number, number];
type Ramp = (t: number) => RGB;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rampMap(stops: RGB[]): Ramp {
  return (t: number) => {
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };
}

export const COLORMAPS: Record<ColormapName, Ramp> = {
  viridis: rampMap([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]),
  magma: rampMap([[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]]),
  grayscale: rampMap([[8, 8, 10], [120, 120, 124], [245, 245, 245]]),
  azure: rampMap([[8, 12, 24], [18, 60, 110], [32, 175, 255], [200, 238, 255]]),
  ember: rampMap([[10, 6, 10], [120, 20, 60], [255, 97, 56], [255, 218, 64]]),
};

export const COLORMAP_NAMES = Object.keys(COLORMAPS) as ColormapName[];
