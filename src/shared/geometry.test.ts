import { describe, expect, it } from 'vitest';
import { cropToPixels, nextFillMode, normalizeCrop, placeImage } from './geometry';

describe('placeImage', () => {
  it('fit letterboxes a 4:3 source on 16:9 (pillarbox)', () => {
    expect(placeImage(1024, 768, 1920, 1080, 'fit')).toEqual({
      x: 240,
      y: 0,
      width: 1440,
      height: 1080,
    });
  });
  it('fit letterboxes a 21:9 source on 16:9 (bars top/bottom)', () => {
    const b = placeImage(2520, 1080, 1920, 1080, 'fit');
    expect(b.width).toBe(1920);
    expect(b.y).toBeGreaterThan(0);
  });
  it('fill covers and centres the overflow', () => {
    expect(placeImage(1024, 768, 1920, 1080, 'fill')).toEqual({
      x: 0,
      y: -180,
      width: 1920,
      height: 1440,
    });
  });
  it('stretch ignores aspect', () => {
    expect(placeImage(1024, 768, 1920, 1080, 'stretch')).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
  it('is safe with an empty source', () => {
    expect(placeImage(0, 0, 100, 50, 'fit')).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe('normalizeCrop', () => {
  it('clamps to the frame and fixes negative drags', () => {
    const close = (
      got: ReturnType<typeof normalizeCrop>,
      want: { x: number; y: number; width: number; height: number },
    ) => {
      expect(got).not.toBeNull();
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(got?.[k]).toBeCloseTo(want[k]);
    };
    close(normalizeCrop({ x: 0.8, y: 0.9, width: -0.5, height: -0.4 }), {
      x: 0.3,
      y: 0.5,
      width: 0.5,
      height: 0.4,
    });
    close(normalizeCrop({ x: -0.2, y: 0.5, width: 0.7, height: 0.8 }), {
      x: 0,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });
  it('rejects non-finite input (it crosses IPC)', () => {
    expect(normalizeCrop({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 })).toBeNull();
  });
  it('drops tiny or full-frame crops', () => {
    expect(normalizeCrop({ x: 0.5, y: 0.5, width: 0.01, height: 0.3 })).toBeNull();
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeCrop(null)).toBeNull();
  });
});

describe('cropToPixels', () => {
  it('maps normalized crop to source pixels', () => {
    expect(cropToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 1920, 1080)).toEqual({
      x: 480,
      y: 540,
      width: 960,
      height: 540,
    });
  });
  it('never exceeds the frame', () => {
    const b = cropToPixels({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, 100, 100);
    expect(b.x + b.width).toBeLessThanOrEqual(100);
    expect(b.width).toBeGreaterThanOrEqual(1);
  });
});

describe('nextFillMode', () => {
  it('cycles fit → fill → stretch → fit (hotkey M)', () => {
    expect(nextFillMode('fit')).toBe('fill');
    expect(nextFillMode('fill')).toBe('stretch');
    expect(nextFillMode('stretch')).toBe('fit');
  });
});
