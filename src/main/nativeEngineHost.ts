import { app, screen, type Display } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ProtocolMismatchError, decodeEvent, encodeEnvelope } from '@shared/engineProtocol';
import {
  DOTNET_DOWNLOAD_URL,
  DOTNET_MAJOR,
  IDLE_NATIVE_ENGINE,
  formatPixelRect,
  parseNetCoreRuntimes,
  pickRuntime,
  type NativeEngineStatus,
} from '@shared/nativeEngine';
import {
  NATIVE_ENGINE_PIPE,
  type EngineCommand,
  type EngineEvent,
  type PhysicalRect,
} from '@shared/outputEngine';
import { log } from './log';

const HELLO_TIMEOUT_MS = 30_000;
const HEARTBEAT_LIMIT_MS = 3_500;
const STOP_GRACE_MS = 3_000;
const STDERR_KEEP = 4_000;

/**
 * Where the engine DLL is. Dev (`npm run dev`, or `npm run dev:host` inside an installed
 * build): build/engine/ under the app path. Packaged: resources/engine/ (bundled in P2.5).
 */
export function engineDllPath(): string {
  // Set by the dev host loader (scripts/devhost/main.js) when running the repo inside an installed build.
  const devRoot = process.env['PROJECTORDESK_DEV_ROOT'];
  if (devRoot) return join(devRoot, 'build', 'engine', 'ProjectorDesk.Engine.dll');
  const appPath = app.getAppPath();
  const packaged = app.isPackaged && appPath.endsWith('.asar');
  return packaged
    ? join(process.resourcesPath, 'engine', 'ProjectorDesk.Engine.dll')
    : join(appPath, 'build', 'engine', 'ProjectorDesk.Engine.dll');
}

function dotnetCandidates(): string[] {
  const list = ['dotnet'];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    list.push(join(pf, 'dotnet', 'dotnet.exe'));
  }
  return list;
}

function listRuntimes(dotnet: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(dotnet, ['--list-runtimes'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** Physical-pixel bounds of a display: the engine is per-monitor DPI aware. */
function physicalBounds(d: Display): PhysicalRect {
  if (process.platform === 'win32') return screen.dipToScreenRect(null, d.bounds);
  const s = d.scaleFactor;
  return {
    x: Math.round(d.bounds.x * s),
    y: Math.round(d.bounds.y * s),
    width: Math.round(d.bounds.width * s),
    height: Math.round(d.bounds.height * s),
  };
}

/**
 * .NET's NamedPipeClientStream maps a pipe name to \\.\pipe\NAME on Windows and to a Unix
 * socket at $TMPDIR/CoreFxPipe_NAME elsewhere (handy for testing the plumbing on Linux).
 */
function pipeAddress(name: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : join(tmpdir(), `CoreFxPipe_${name}`);
}

const pipeBaseName = NATIVE_ENGINE_PIPE.replace(/^\\\\\.\\pipe\\/, '');

/**
 * Runs the Phase 2 engine (`dotnet ProjectorDesk.Engine.dll`) and talks to it over a private
 * named pipe: handshake (protocol version + per-launch token), heartbeat watchdog, and
 * placement on the target display, following display changes like Phase 1's Output.
 * P2.1: the window is a topmost black test surface; capture arrives in P2.2.
 */
export class NativeEngineHost {
  private proc: ChildProcess | null = null;
  private server: Server | null = null;
  private socket: Socket | null = null;
  private pipePath: string | null = null;
  private token = '';
  private seq = 0;
  private status: NativeEngineStatus = IDLE_NATIVE_ENGINE;
  private helloTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private lastBeat = 0;
  private stopping = false;
  private target: Display | undefined;
  /** Set when the target display went away while placed; the next exact placement counts as a recovery. */
  private hiddenForUnplug = false;

  constructor(private readonly onChange: () => void) {}

  get current(): NativeEngineStatus {
    return this.status;
  }

  get running(): boolean {
    return this.proc !== null;
  }

  private update(patch: Partial<NativeEngineStatus>): void {
    this.status = { ...this.status, ...patch, at: new Date().toISOString() };
    this.onChange();
  }

  private fail(message: string, extra: Partial<NativeEngineStatus> = {}): void {
    log('error', `Native engine: ${message}`);
    this.update({ state: 'failed', message, ...extra });
    this.teardown(true);
  }

  async start(target: Display | undefined): Promise<void> {
    if (this.proc) await this.stop();
    this.stopping = false;
    this.hiddenForUnplug = false;
    this.target = target;
    this.status = { ...IDLE_NATIVE_ENGINE };
    this.update({ state: 'checking', message: `Looking for .NET ${DOTNET_MAJOR}…` });

    if (!target) {
      this.fail('No projector display: connect it and set Windows to Extend first.');
      return;
    }

    let dotnetPath: string | null = null;
    let runtimes: string | null = null;
    for (const candidate of dotnetCandidates()) {
      runtimes = await listRuntimes(candidate);
      if (runtimes !== null) {
        dotnetPath = candidate;
        break;
      }
    }
    if (!dotnetPath || runtimes === null) {
      this.fail(
        `.NET isn't installed. Install the .NET ${DOTNET_MAJOR} Runtime (x64) from ${DOTNET_DOWNLOAD_URL}, then try again.`,
      );
      return;
    }
    const runtime = pickRuntime(parseNetCoreRuntimes(runtimes));
    if (!runtime) {
      const found = parseNetCoreRuntimes(runtimes).join(', ') || 'none';
      this.fail(
        `.NET ${DOTNET_MAJOR} isn't installed (found: ${found}). Install the .NET ${DOTNET_MAJOR} Runtime (x64) from ${DOTNET_DOWNLOAD_URL}, then try again.`,
        { dotnetPath },
      );
      return;
    }

    const dll = engineDllPath();
    if (!existsSync(dll)) {
      this.fail(
        `Engine not built (${dll} is missing). Run "npm run engine:build" (needs the .NET ${DOTNET_MAJOR} SDK) and try again.`,
        { dotnetPath, runtime },
      );
      return;
    }

    // A fresh, unguessable pipe per launch; the token proves the connecting engine is ours.
    const pipeName = `${pipeBaseName}-${process.pid}-${randomBytes(6).toString('hex')}`;
    this.token = randomBytes(16).toString('hex');
    this.seq = 0;
    try {
      await this.listen(pipeAddress(pipeName));
    } catch (err) {
      this.fail(`Could not open the engine pipe: ${String(err)}`);
      return;
    }

    log(
      'info',
      `Native engine: starting "${dotnetPath}" ${dll} (.NET ${runtime}), pipe ${pipeName}`,
    );
    this.update({
      state: 'starting',
      message: 'Starting the engine…',
      dotnetPath,
      runtime,
      engineDll: dll,
      pipe: pipeName,
    });

    let proc: ChildProcess;
    try {
      proc = spawn(dotnetPath, [dll, '--pipe', pipeName, '--token', this.token], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.fail(`Could not start dotnet: ${String(err)}`);
      return;
    }
    this.proc = proc;
    this.update({ pid: proc.pid ?? null });

    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.fail(`Could not start dotnet: ${err.message}`);
    });
    for (const stream of [proc.stdout, proc.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        if (this.proc === proc) this.appendStderr(chunk);
      });
    }
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const how = code !== null ? `exit code ${code}` : `signal ${String(signal)}`;
      if (this.stopping) {
        log('info', `Native engine: stopped (${how})`);
        this.update({ state: 'stopped', message: 'Engine closed.', exitCode: code, pid: null });
        this.teardown(false);
      } else if (this.status.state !== 'failed') {
        this.fail(
          `The engine exited unexpectedly (${how}). If Smart App Control blocked it, Windows showed a notification and the details below may say so.`,
          { exitCode: code, pid: null },
        );
      } else {
        this.update({ exitCode: code, pid: null });
      }
    });

    this.helloTimer = setTimeout(() => {
      if (this.proc === proc && !this.status.engine) {
        this.fail(`No handshake from the engine within ${HELLO_TIMEOUT_MS / 1000} s; stopping it.`);
      }
    }, HELLO_TIMEOUT_MS);
  }

  private listen(address: string): Promise<void> {
    if (process.platform !== 'win32') rmSync(address, { force: true });
    this.pipePath = address;
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        if (this.socket) {
          socket.destroy();
          return;
        }
        this.socket = socket;
        socket.setEncoding('utf8');
        createInterface({ input: socket }).on('line', (line) => {
          if (this.socket === socket) this.onLine(line);
        });
        socket.on('error', () => undefined);
        socket.on('close', () => {
          if (this.socket === socket) this.socket = null;
        });
      });
      server.once('error', reject);
      server.listen(address, () => {
        server.off('error', reject);
        resolve();
      });
      this.server = server;
    });
  }

  private send(cmd: EngineCommand): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(`${encodeEnvelope(++this.seq, cmd)}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: EngineEvent;
    try {
      msg = decodeEvent(line).msg;
    } catch (err) {
      if (err instanceof ProtocolMismatchError) {
        this.fail(
          `Engine and app don't match: ${err.message}. Rebuild the engine (npm run engine:build).`,
        );
        return;
      }
      log('warn', `Native engine: ignoring bad message (${String(err)}): ${line.slice(0, 200)}`);
      return;
    }
    this.handle(msg);
  }

  private handle(m: EngineEvent): void {
    switch (m.type) {
      case 'hello': {
        if (m.token !== this.token) {
          this.fail('An unexpected process connected to the engine pipe; stopping.');
          return;
        }
        this.clearHelloTimer();
        this.lastBeat = Date.now();
        this.watchdog = setInterval(() => {
          if (this.status.engine && Date.now() - this.lastBeat > HEARTBEAT_LIMIT_MS) {
            this.fail(
              `The engine stopped responding (no heartbeat for ${HEARTBEAT_LIMIT_MS / 1000} s).`,
            );
          }
        }, 1_000);
        log(
          'info',
          `Native engine: connected, ${m.engine} ${m.version}, protocol ${m.protocol}, ${m.runtime}, ${m.os}`,
        );
        this.update({
          state: 'connected',
          message: 'Connected; placing the test window…',
          engine: { version: m.version, runtime: m.runtime, os: m.os, protocol: m.protocol },
        });
        this.place('handshake');
        return;
      }
      case 'probe':
        log(
          m.ok ? 'info' : 'warn',
          `Native engine: ${m.name} ${m.ok ? 'OK' : 'FAILED'}: ${m.detail}`,
        );
        this.update({
          probes: [...this.status.probes, { name: m.name, ok: m.ok, detail: m.detail }],
        });
        return;
      case 'placed': {
        const p = m.placement;
        const recovered = this.hiddenForUnplug && p.exact;
        if (recovered) this.hiddenForUnplug = false;
        const problems = [
          m.affinity.verified
            ? null
            : `capture exclusion NOT verified (affinity ${m.affinity.actual})`,
          p.exact ? null : `placement: ${p.problems.join('; ')}`,
          m.dpiAwareness === 'per-monitor v2' ? null : `DPI awareness ${m.dpiAwareness}`,
          ...this.status.probes.filter((x) => !x.ok).map((x) => `failed to load ${x.name}`),
        ].filter((x): x is string => x !== null);
        log(
          problems.length ? 'warn' : 'info',
          `Native engine: placed ${formatPixelRect(p.actual)} on monitor ${formatPixelRect(p.monitor)} (requested ${formatPixelRect(p.requested)})${p.notes.length ? `; ${p.notes.join('; ')}` : ''}${p.problems.length ? `; PROBLEMS: ${p.problems.join('; ')}` : ''}${recovered ? '; back after unplug' : ''}`,
        );
        this.update({
          state: 'placed',
          message: problems.length
            ? `Placed, with problems: ${problems.join('; ')}.`
            : 'Placed: the black test window covers the projector. Capture exclusion verified, placement exact.',
          dpiAwareness: m.dpiAwareness,
          affinity: { actual: m.affinity.actual, verified: m.affinity.verified },
          placement: p,
          placements: this.status.placements + 1,
          hotplugRecoveries: this.status.hotplugRecoveries + (recovered ? 1 : 0),
        });
        return;
      }
      case 'heartbeat':
        this.lastBeat = Date.now();
        // Shown in the panel; updated at most every 5 s to keep state pushes quiet.
        if (
          !this.status.lastHeartbeatAt ||
          Date.now() - Date.parse(this.status.lastHeartbeatAt) > 5_000
        ) {
          this.update({ lastHeartbeatAt: new Date().toISOString() });
        }
        return;
      case 'error': {
        const { code, message } = m.error;
        if (code === 'internal' || code === 'display-not-found') {
          log('warn', `Native engine: ${code}: ${message}`);
          this.update({ message: `Engine reported: ${message}` });
          return;
        }
        this.fail(`Engine error (${code}): ${message}`);
        return;
      }
      case 'stats':
      case 'sourceEnded':
        return;
    }
  }

  /** Follow Phase 1's target display: re-place on changes, hide while it's unplugged. */
  retarget(target: Display | undefined, reason: string): void {
    this.target = target;
    if (!this.status.engine || !this.proc) return;
    if (!target) {
      if (this.status.state === 'placed') this.hiddenForUnplug = true;
      log('info', `Native engine: hiding (${reason})`);
      this.send({ type: 'stop' });
      this.update({
        state: 'hidden',
        message:
          'No projector display: the engine window is hidden and comes back with the display.',
      });
      return;
    }
    this.place(reason);
  }

  private place(reason: string): void {
    const t = this.target;
    if (!t) {
      this.retarget(undefined, reason);
      return;
    }
    const bounds = physicalBounds(t);
    log(
      'info',
      `Native engine: placing on display ${t.id} at ${formatPixelRect(bounds)} (${reason})`,
    );
    this.update({ targetDisplayId: t.id, targetDip: { ...t.bounds } });
    this.send({ type: 'start', targetDisplayId: t.id, bounds, topmost: true });
  }

  private appendStderr(text: string): void {
    const s = (this.status.stderr + text + (text.endsWith('\n') ? '' : '\n')).slice(-STDERR_KEEP);
    this.update({ stderr: s });
  }

  private clearHelloTimer(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
  }

  /** Close timers, pipe and (when `kill`) the process. */
  private teardown(kill: boolean): void {
    this.clearHelloTimer();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.socket?.destroy();
    this.socket = null;
    this.server?.close();
    this.server = null;
    if (this.pipePath && process.platform !== 'win32') rmSync(this.pipePath, { force: true });
    this.pipePath = null;
    if (kill && this.proc) {
      const p = this.proc;
      this.proc = null;
      p.kill();
    }
  }

  /** Close the engine: ask over the pipe, then kill. */
  stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) {
      this.teardown(false);
      return Promise.resolve();
    }
    this.stopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill();
        resolve();
      }, STOP_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      this.send({ type: 'shutdown' });
    });
  }

  /** App quitting: closing the pipe makes the engine close its window and exit. */
  dispose(): void {
    this.stopping = true;
    const p = this.proc;
    this.teardown(false);
    if (p) setTimeout(() => p.kill(), STOP_GRACE_MS).unref();
  }
}
