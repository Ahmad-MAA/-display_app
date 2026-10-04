import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEYS, localAction } from './controls';

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
