import { describe, expect, it } from 'vitest';
import { RestartBudget, describeError } from './recovery';

describe('RestartBudget', () => {
  it('allows max attempts per window, then refuses', () => {
    const b = new RestartBudget(3, 60_000);
    expect(b.tryConsume(0)).toBe(true);
    expect(b.tryConsume(1000)).toBe(true);
    expect(b.tryConsume(2000)).toBe(true);
    expect(b.tryConsume(3000)).toBe(false);
  });

  it('frees attempts that fall out of the window', () => {
    const b = new RestartBudget(2, 10_000);
    expect(b.tryConsume(0)).toBe(true);
    expect(b.tryConsume(5000)).toBe(true);
    expect(b.tryConsume(9000)).toBe(false);
    expect(b.tryConsume(10_001)).toBe(true);
  });
});

describe('describeError', () => {
  it('handles errors, strings and objects', () => {
    expect(describeError(new Error('boom'))).toContain('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });
});
