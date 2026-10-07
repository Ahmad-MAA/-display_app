import { describe, expect, it } from 'vitest';
import { isHdrDisplay, shortColorSpace } from './displays';
import { parseSourceId } from './outputEngine';

describe('isHdrDisplay', () => {
  it('treats 24-bit sRGB as SDR', () => {
    expect(
      isHdrDisplay({
        colorDepth: 24,
        colorSpace: '{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}',
      }),
    ).toBe(false);
  });
  it('flags deep colour or HDR transfer functions', () => {
    expect(isHdrDisplay({ colorDepth: 30, colorSpace: '' })).toBe(true);
    expect(
      isHdrDisplay({
        colorDepth: 24,
        colorSpace: '{primaries:BT709, transfer:SCRGB_LINEAR_80_NITS}',
      }),
    ).toBe(true);
  });
});

describe('shortColorSpace', () => {
  it('extracts primaries/transfer', () => {
    expect(shortColorSpace('{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}')).toBe(
      'BT709/SRGB',
    );
  });
  it('passes unknown formats through', () => {
    expect(shortColorSpace('weird')).toBe('weird');
  });
});

describe('parseSourceId', () => {
  it('parses window ids into an HWND', () => {
    expect(parseSourceId('window:132456:0')).toEqual({ kind: 'window', hwnd: '132456' });
  });
  it('parses screen ids', () => {
    expect(parseSourceId('screen:1:0')).toEqual({ kind: 'screen', index: '1' });
  });
  it('rejects garbage', () => {
    expect(parseSourceId('tab:1')).toBeNull();
  });
});
