import { describe, expect, it } from 'vitest';
import { resolveTarget } from './targeting';

const base = { primaryId: 1, preferredId: null, currentId: null, lostId: null };

describe('resolveTarget', () => {
  it('returns null with only the primary (no projector / Duplicate mode)', () => {
    expect(resolveTarget({ ...base, displayIds: [1] })).toBeNull();
  });

  it('picks the first non-primary display by default', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2, 3] })).toBe(2);
  });

  it('honours the user override', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2, 3], preferredId: 3 })).toBe(3);
  });

  it('never targets the primary even if preferred', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2], preferredId: 1 })).toBe(2);
  });

  it('falls back when the preferred display is gone', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2], preferredId: 3 })).toBe(2);
  });

  it('stays on the current target when another monitor appears', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2, 3], currentId: 3 })).toBe(3);
  });

  it('stays hidden after the target is unplugged, even if another secondary exists', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2], currentId: 3, lostId: 3 })).toBeNull();
  });

  it('restores the lost display when it comes back', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2, 3], lostId: 3 })).toBe(3);
  });

  it('targets the old primary when the projector becomes primary (Control Panel moves too)', () => {
    expect(resolveTarget({ ...base, displayIds: [1, 2], primaryId: 2, currentId: 2 })).toBe(1);
  });
});
