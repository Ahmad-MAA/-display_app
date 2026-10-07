/**
 * Pure layout math for fill modes and crop (shared by the Output renderer, the crop editor,
 * and any future native engine).
 */
import type { FillMode } from './outputEngine';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop rectangle in source-normalized coordinates (0..1 of the frame), so it survives
 * source resizes and means the same thing to every engine.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_CROP = 0.02;

/** How the Output presents the captured frame. */
export interface OutputDisplay {
  fillMode: FillMode;
  crop: CropRect | null;
}

export const DEFAULT_DISPLAY: OutputDisplay = { fillMode: 'fit', crop: null };

/**
 * Where a srcW×srcH image lands inside a dstW×dstH area.
 * fit = whole image visible, letterboxed; fill = area covered, overflow clipped;
 * stretch = area covered, aspect ignored.
 */
export function placeImage(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: FillMode,
): Box {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 || mode === 'stretch') {
    return { x: 0, y: 0, width: dstW, height: dstH };
  }
  const scale =
    mode === 'fit' ? Math.min(dstW / srcW, dstH / srcH) : Math.max(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height };
}

/** Clamp to the frame and enforce a minimum size; null for "no crop" (≈ full frame). */
export function normalizeCrop(c: CropRect | null): CropRect | null {
  if (!c || ![c.x, c.y, c.width, c.height].every(Number.isFinite)) return null;
  const x0 = Math.min(Math.max(Math.min(c.x, c.x + c.width), 0), 1);
  const y0 = Math.min(Math.max(Math.min(c.y, c.y + c.height), 0), 1);
  const x1 = Math.min(Math.max(Math.max(c.x, c.x + c.width), 0), 1);
  const y1 = Math.min(Math.max(Math.max(c.y, c.y + c.height), 0), 1);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < MIN_CROP || height < MIN_CROP) return null;
  if (x0 < 0.001 && y0 < 0.001 && width > 0.999 && height > 0.999) return null;
  return { x: x0, y: y0, width, height };
}

/** Crop → source pixels (rounded, at least 1 px). */
export function cropToPixels(c: CropRect, videoW: number, videoH: number): Box {
  const x = Math.min(Math.max(0, Math.round(c.x * videoW)), Math.max(0, videoW - 1));
  const y = Math.min(Math.max(0, Math.round(c.y * videoH)), Math.max(0, videoH - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(videoW - x, Math.round(c.width * videoW))),
    height: Math.max(1, Math.min(videoH - y, Math.round(c.height * videoH))),
  };
}

export const FILL_MODES: readonly FillMode[] = ['fit', 'fill', 'stretch'];

export function nextFillMode(m: FillMode): FillMode {
  return FILL_MODES[(FILL_MODES.indexOf(m) + 1) % FILL_MODES.length] ?? 'fit';
}
