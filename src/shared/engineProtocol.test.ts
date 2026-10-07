import { describe, expect, it, vi } from 'vitest';
import { decodeCommand, dispatchCommand, encodeEnvelope } from './engineProtocol';
import type { EngineCommand, OutputEngine } from './outputEngine';

function fakeEngine() {
  return {
    kind: 'electron' as const,
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    setSource: vi.fn(() => Promise.resolve()),
    setFillMode: vi.fn(),
    setCrop: vi.fn(),
    blank: vi.fn(),
    freeze: vi.fn(),
    setCursor: vi.fn(),
    onStats: vi.fn(() => () => undefined),
    onSourceEnded: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
  } satisfies OutputEngine;
}

describe('engine protocol', () => {
  it('round-trips a command through the versioned envelope', () => {
    const cmd: EngineCommand = { type: 'setFillMode', mode: 'fill' };
    const line = encodeEnvelope(7, cmd);
    expect(JSON.parse(line)).toEqual({ v: 1, seq: 7, msg: cmd });
    expect(decodeCommand(line)).toEqual({ v: 1, seq: 7, msg: cmd });
  });

  it('rejects other protocol versions and unknown commands', () => {
    expect(() =>
      decodeCommand(JSON.stringify({ v: 2, seq: 1, msg: { type: 'blank', on: true } })),
    ).toThrow(/version/);
    expect(() =>
      decodeCommand(JSON.stringify({ v: 1, seq: 1, msg: { type: 'selfDestruct' } })),
    ).toThrow(/unknown/);
    expect(() => decodeCommand('not json')).toThrow();
  });

  it('dispatches every command to the engine', async () => {
    const e = fakeEngine();
    await dispatchCommand(e, { type: 'blank', on: true });
    await dispatchCommand(e, { type: 'freeze', on: false });
    await dispatchCommand(e, { type: 'setCursor', on: false });
    await dispatchCommand(e, { type: 'setCrop', rect: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    await dispatchCommand(e, { type: 'setSource', source: null });
    expect(e.blank).toHaveBeenCalledWith(true);
    expect(e.freeze).toHaveBeenCalledWith(false);
    expect(e.setCursor).toHaveBeenCalledWith(false);
    expect(e.setCrop).toHaveBeenCalledWith({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(e.setSource).toHaveBeenCalledWith(null);
  });
});
