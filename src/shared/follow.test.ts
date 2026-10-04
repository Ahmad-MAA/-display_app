import { describe, expect, it } from 'vitest';
import { chooseFollow, decisionKey, Stabilizer, type WinInfo } from './follow';

const mon = { x: 0, y: 0, width: 1920, height: 1200 };
const win = (o: Partial<WinInfo>): WinInfo => ({
  hwnd: '1',
  pid: 100,
  processName: 'wmplayer',
  title: 'Windows Media Player Legacy',
  className: 'WMPlayerApp',
  exists: true,
  visible: true,
  minimized: false,
  maximized: false,
  cloaked: false,
  owned: false,
  fullscreen: false,
  topmost: false,
  coverage: 0,
  rect: { x: 100, y: 100, width: 800, height: 600 },
  monitor: mon,
  ...o,
});

describe('chooseFollow', () => {
  const main = win({});

  it('stays on the picked window when nothing is full screen', () => {
    expect(chooseFollow(main, [], null)).toEqual({ kind: 'primary' });
  });

  it('follows a separate full-screen window of the same process (WMP / VLC / slide show)', () => {
    const fs = win({ hwnd: '2', className: 'WMP Skin Host', fullscreen: true, rect: mon });
    expect(chooseFollow(main, [fs], null)).toEqual({ kind: 'window', win: fs });
  });

  it('keeps capturing the picked window when IT goes full screen (Chrome / Edge / YouTube)', () => {
    const self = win({ fullscreen: true, rect: mon });
    const other = win({ hwnd: '2', fullscreen: true });
    expect(chooseFollow(self, [other], null)).toEqual({ kind: 'primary' });
  });

  it('ignores full-screen windows of other processes', () => {
    const other = win({ hwnd: '2', pid: 200, fullscreen: true });
    expect(chooseFollow(main, [other], null)).toEqual({ kind: 'primary' });
  });

  it('never follows PowerPoint Presenter View; follows the slide show', () => {
    const ppt = win({ processName: 'POWERPNT', className: 'PPTFrameClass' });
    const presenter = win({ hwnd: '2', className: 'PodiumParent', fullscreen: true });
    const show = win({ hwnd: '3', className: 'screenClass', fullscreen: true });
    expect(chooseFollow(ppt, [presenter, show], null)).toEqual({ kind: 'window', win: show });
    expect(chooseFollow(ppt, [presenter], null)).toEqual({ kind: 'primary' });
  });

  it('skips WMP’s short-lived transition window (avoids a black gap)', () => {
    const transition = win({ hwnd: '2', title: 'WMPTransition', fullscreen: true });
    const real = win({ hwnd: '3', title: 'Windows Media Player', fullscreen: true });
    expect(chooseFollow(main, [transition, real], null)).toEqual({ kind: 'window', win: real });
    expect(chooseFollow(main, [transition], null)).toEqual({ kind: 'primary' });
  });

  it('sticks with the window already being followed', () => {
    const a = win({ hwnd: '2', fullscreen: true });
    const b = win({ hwnd: '3', fullscreen: true });
    expect(chooseFollow(main, [a, b], '3')).toEqual({ kind: 'window', win: b });
  });

  it('follows even if the picked window is hidden/minimized while full screen (WMP hides it)', () => {
    const hidden = win({ visible: false, minimized: true });
    const fs = win({ hwnd: '2', fullscreen: true });
    expect(chooseFollow(hidden, [fs], null)).toEqual({ kind: 'window', win: fs });
  });

  it('returns to primary when the picked window no longer exists (closed → normal "Source closed")', () => {
    const gone = win({ exists: false });
    expect(chooseFollow(gone, [win({ hwnd: '2', fullscreen: true })], null)).toEqual({
      kind: 'primary',
    });
  });

  it('keys decisions by window', () => {
    expect(decisionKey({ kind: 'primary' })).toBe('primary');
    expect(decisionKey({ kind: 'window', win: win({ hwnd: '9' }) })).toBe('window:9');
  });
});

describe('Stabilizer', () => {
  it('commits only after two identical observations', () => {
    const s = new Stabilizer(2);
    expect(s.push('window:2')).toBe(false);
    expect(s.push('window:2')).toBe(true);
    expect(s.push('window:2')).toBe(false); // already committed
  });

  it('ignores a one-poll blip', () => {
    const s = new Stabilizer(2);
    expect(s.push('window:2')).toBe(false);
    expect(s.push('primary')).toBe(false);
    expect(s.push('window:2')).toBe(false);
  });

  it('switches back after two observations', () => {
    const s = new Stabilizer(2);
    s.push('window:2');
    s.push('window:2');
    expect(s.push('primary')).toBe(false);
    expect(s.push('primary')).toBe(true);
  });
});
