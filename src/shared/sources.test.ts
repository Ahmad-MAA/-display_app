import { describe, expect, it } from 'vitest';
import { filterSources, isBlankBitmap, toDescriptor, type CaptureSource } from './sources';

describe('toDescriptor', () => {
  it('carries the HWND, process name and title for windows', () => {
    expect(
      toDescriptor(
        { id: 'window:65890:0', name: 'Deck.pptx - PowerPoint', display_id: '' },
        'POWERPNT',
      ),
    ).toEqual({
      sourceId: 'window:65890:0',
      kind: 'window',
      hwnd: '65890',
      displayId: null,
      processName: 'POWERPNT',
      title: 'Deck.pptx - PowerPoint',
    });
  });
  it('carries the display id for screens', () => {
    expect(
      toDescriptor({ id: 'screen:1:0', name: 'Screen 2', display_id: '47307338' }, null),
    ).toMatchObject({
      kind: 'screen',
      hwnd: null,
      displayId: '47307338',
    });
  });
  it('rejects unknown ids', () => {
    expect(toDescriptor({ id: 'tab:3', name: 'x', display_id: '' }, null)).toBeNull();
  });
});

describe('isBlankBitmap', () => {
  const w = 32;
  const h = 18;
  const black = () => new Uint8Array(w * h * 4);
  it('detects an all-black bitmap', () => {
    expect(isBlankBitmap(black(), w, h)).toBe(true);
  });
  it('detects an empty bitmap', () => {
    expect(isBlankBitmap(new Uint8Array(0), 0, 0)).toBe(true);
  });
  it('treats near-black noise as blank', () => {
    const b = black().fill(6);
    expect(isBlankBitmap(b, w, h)).toBe(true);
  });
  it('sees real content', () => {
    const b = black();
    b.fill(200, 0, w * 4 * 2); // two bright rows at the top
    expect(isBlankBitmap(b, w, h)).toBe(false);
  });
});

describe('filterSources', () => {
  const mk = (
    kind: 'window' | 'screen',
    title: string,
    processName: string | null,
  ): CaptureSource => ({
    descriptor: { sourceId: `${kind}:1:0`, kind, hwnd: null, displayId: null, processName, title },
    thumbnail: null,
    icon: null,
    thumbnailBlank: false,
    isProjectorScreen: false,
    displayLabel: null,
  });
  const all = [
    mk('window', 'Quarterly review - PowerPoint', 'POWERPNT'),
    mk('window', 'Inbox', 'olk'),
    mk('screen', 'Screen 1', null),
  ];
  it('splits by kind', () => {
    expect(filterSources(all, 'window', '')).toHaveLength(2);
    expect(filterSources(all, 'screen', '')).toHaveLength(1);
  });
  it('matches title or process name, case-insensitively', () => {
    expect(filterSources(all, 'window', 'powerpnt')).toHaveLength(1);
    expect(filterSources(all, 'window', 'INBOX')).toHaveLength(1);
  });
});
