import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, DEFAULT_HOTKEYS, localAction } from './controls';

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {},
) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('localAction', () => {
  it('maps the spec keys inside the Control Panel', () => {
    expect(localAction(key('b'))).toBe('blank');
    expect(localAction(key('F', { shiftKey: true }))).toBe('freeze');
    expect(localAction(key('m'))).toBe('fill-cycle');
    expect(localAction(key('s'))).toBe('stats');
    expect(localAction(key('Escape'))).toBe('hide-output');
    expect(localAction(key('ArrowRight', { ctrlKey: true }))).toBe('next');
    expect(localAction(key('ArrowLeft', { ctrlKey: true }))).toBe('prev');
  });
  it('ignores other modifiers and keys (Ctrl+S, Alt+B, plain arrows)', () => {
    expect(localAction(key('s', { ctrlKey: true }))).toBeNull();
    expect(localAction(key('b', { altKey: true }))).toBeNull();
    expect(localAction(key('ArrowRight'))).toBeNull();
    expect(localAction(key('x'))).toBeNull();
  });
});

describe('DEFAULT_HOTKEYS', () => {
  it('global combos all need Ctrl+Alt and avoid Ctrl+Alt+Arrow (Intel screen rotation)', () => {
    for (const h of DEFAULT_HOTKEYS) {
      expect(h.global.startsWith('CommandOrControl+Alt+')).toBe(true);
      expect(h.global).not.toMatch(/\+(Up|Down|Left|Right)$/);
    }
  });
  it('has unique accelerators', () => {
    const all = DEFAULT_HOTKEYS.map((h) => h.global);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('acceleratorFromEvent', () => {
  const ev = (
    o: Partial<{
      key: string;
      code: string;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      metaKey: boolean;
    }>,
  ) => ({
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...o,
  });
  it('builds Electron accelerators', () => {
    expect(
      acceleratorFromEvent(ev({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true })),
    ).toEqual({
      accelerator: 'CommandOrControl+Alt+B',
    });
    expect(
      acceleratorFromEvent(
        ev({ key: 'PageDown', code: 'PageDown', ctrlKey: true, shiftKey: true }),
      ),
    ).toEqual({
      accelerator: 'CommandOrControl+Shift+PageDown',
    });
    expect(acceleratorFromEvent(ev({ key: 'F9', code: 'F9', altKey: true }))).toEqual({
      accelerator: 'Alt+F9',
    });
  });
  it('uses the physical key so layouts with AltGr letters still record B', () => {
    expect(
      acceleratorFromEvent(ev({ key: '∫', code: 'KeyB', ctrlKey: true, altKey: true })),
    ).toEqual({
      accelerator: 'CommandOrControl+Alt+B',
    });
  });
  it('waits while only modifiers are held', () => {
    expect(
      acceleratorFromEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true })),
    ).toBeNull();
  });
  it('refuses bare keys and Shift-only combos', () => {
    expect(acceleratorFromEvent(ev({ key: 'b', code: 'KeyB' }))).toHaveProperty('error');
    expect(acceleratorFromEvent(ev({ key: 'B', code: 'KeyB', shiftKey: true }))).toHaveProperty(
      'error',
    );
  });
});
