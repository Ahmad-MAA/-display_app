/**
 * Versioned JSON wire format between main and an OutputEngine. Phase 1 dispatches these
 * in-process; Phase 2 sends the same envelopes, one per line, over \\.\pipe\projectordesk
 * to the native engine process.
 */
import { normalizeCrop } from './geometry';
import {
  ENGINE_PROTOCOL_VERSION,
  type EngineCommand,
  type EngineEnvelope,
  type EngineEvent,
  type OutputEngine,
} from './outputEngine';

export function encodeEnvelope(seq: number, msg: EngineCommand | EngineEvent): string {
  const env: EngineEnvelope<EngineCommand | EngineEvent> = { v: ENGINE_PROTOCOL_VERSION, seq, msg };
  return JSON.stringify(env);
}

const COMMANDS = new Set([
  'start',
  'stop',
  'setSource',
  'setFillMode',
  'setCrop',
  'blank',
  'freeze',
  'setCursor',
  'shutdown',
]);

const EVENTS = new Set(['hello', 'probe', 'placed', 'heartbeat', 'stats', 'sourceEnded', 'error']);

/**
 * Parse one line from the engine. Throws with a reason on anything malformed; a version
 * mismatch says so explicitly, because the fix (rebuild the engine) differs.
 */
export function decodeEvent(line: string): EngineEnvelope<EngineEvent> {
  const raw: unknown = JSON.parse(line);
  if (typeof raw !== 'object' || raw === null) throw new Error('envelope is not an object');
  const env = raw as { v?: unknown; seq?: unknown; msg?: unknown };
  if (env.v !== ENGINE_PROTOCOL_VERSION) {
    throw new ProtocolMismatchError(
      `engine speaks protocol version ${String(env.v)}, this app expects ${ENGINE_PROTOCOL_VERSION}`,
    );
  }
  if (typeof env.seq !== 'number') throw new Error('missing seq');
  const msg = env.msg as { type?: unknown } | undefined;
  if (!msg || typeof msg.type !== 'string' || !EVENTS.has(msg.type)) {
    throw new Error(`unknown event ${String(msg?.type)}`);
  }
  return env as EngineEnvelope<EngineEvent>;
}

export class ProtocolMismatchError extends Error {
  override name = 'ProtocolMismatchError';
}

/** Parse one line into a command envelope; throws with a reason on anything malformed. */
export function decodeCommand(line: string): EngineEnvelope<EngineCommand> {
  const raw: unknown = JSON.parse(line);
  if (typeof raw !== 'object' || raw === null) throw new Error('envelope is not an object');
  const env = raw as { v?: unknown; seq?: unknown; msg?: unknown };
  if (env.v !== ENGINE_PROTOCOL_VERSION) {
    throw new Error(
      `protocol version ${String(env.v)} not supported (want ${ENGINE_PROTOCOL_VERSION})`,
    );
  }
  if (typeof env.seq !== 'number') throw new Error('missing seq');
  const msg = env.msg as { type?: unknown } | undefined;
  if (!msg || typeof msg.type !== 'string' || !COMMANDS.has(msg.type)) {
    throw new Error(`unknown command ${String(msg?.type)}`);
  }
  return env as EngineEnvelope<EngineCommand>;
}

/** Apply a command to any engine implementation (Electron today, native in Phase 2). */
export async function dispatchCommand(engine: OutputEngine, cmd: EngineCommand): Promise<void> {
  switch (cmd.type) {
    case 'start':
      await engine.start(cmd.targetDisplayId);
      return;
    case 'stop':
      await engine.stop();
      return;
    case 'setSource':
      await engine.setSource(cmd.source);
      return;
    case 'setFillMode':
      engine.setFillMode(cmd.mode);
      return;
    case 'setCrop':
      engine.setCrop(normalizeCrop(cmd.rect));
      return;
    case 'blank':
      engine.blank(cmd.on);
      return;
    case 'freeze':
      engine.freeze(cmd.on);
      return;
    case 'setCursor':
      engine.setCursor(cmd.on);
      return;
    case 'shutdown':
      await engine.stop();
      return;
  }
}
