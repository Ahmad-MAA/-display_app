import { describe, expect, it } from 'vitest';
import { coveringKey, relevantCovering } from './covering';
import type { WinInfo } from './follow';

const w = (o: Partial<WinInfo>): WinInfo => ({
  hwnd: '1',
  pid: 1,
  processName: 'wps',
  title: 'WPS Presentation Slide Show - [SCOPEDECK.pptx]',
  className: 'WPS Show Window',
  exists: true,
  visible: true,
  minimized: false,
  maximized: false,
  cloaked: false,
  owned: false,
  fullscreen: true,
  topmost: true,
  coverage: 100,
  layered: false,
  transparent: false,
  toolWindow: false,
  noActivate: false,
  exStyle: '0x0',
  rect: null,
  monitor: null,
  ...o,
});

describe('relevantCovering', () => {
  it('reports a topmost full-screen slide show on the projector', () => {
    expect(relevantCovering([w({})], new Set())).toEqual([
      {
        hwnd: '1',
        title: 'WPS Presentation Slide Show - [SCOPEDECK.pptx]',
        processName: 'wps',
        topmost: true,
        fullscreen: true,
        coverage: 100,
      },
    ]);
  });

  it('ignores taskbars/shell and our own windows', () => {
    const list = [
      w({ hwnd: '2', className: 'Shell_SecondaryTrayWnd', coverage: 30 }),
      w({ hwnd: '3', className: 'Chrome_WidgetWin_1', title: 'ProjectorDesk' }),
    ];
    expect(relevantCovering(list, new Set(['3']))).toEqual([]);
  });

  it('keys by window set, order-independent', () => {
    const a = relevantCovering([w({ hwnd: '5' }), w({ hwnd: '4' })], new Set());
    const b = relevantCovering([w({ hwnd: '4' }), w({ hwnd: '5' })], new Set());
    expect(coveringKey(a)).toBe(coveringKey(b));
  });
});
