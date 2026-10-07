import { app, screen, type Display } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  DOTNET_DOWNLOAD_URL,
  DOTNET_MAJOR,
  IDLE_NATIVE_PROBE,
  formatPixelRect,
  parseEngineLine,
  parseNetCoreRuntimes,
  pickRuntime,
  type EngineReport,
  type NativeProbeStatus,
  type PixelRect,
} from '@shared/nativeEngine';
import { log } from './log';

const READY_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 3_000;
const STDERR_KEEP = 4_000;

/** Dev: `npm run engine:build` output. Packaged builds bundle it in P2.5. */
export function engineDllPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'engine', 'ProjectorDesk.Engine.dll')
    : join(app.getAppPath(), 'build', 'engine', 'ProjectorDesk.Engine.dll');
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
function physicalBounds(d: Display): PixelRect {
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
 * P2.0 feasibility check: start the native engine with `dotnet`, let it open its black window
 * over the projector (topmost, so it covers Phase 1's Output) and report what it could load.
 * Answers: does Smart App Control let our unsigned DLLs run under the Microsoft-signed host?
 */
export class NativeProbe {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private status: NativeProbeStatus = IDLE_NATIVE_PROBE;
  private readyTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly onChange: () => void) {}

  get current(): NativeProbeStatus {
    return this.status;
  }

  private update(patch: Partial<NativeProbeStatus>): void {
    this.status = { ...this.status, ...patch, at: new Date().toISOString() };
    this.onChange();
  }

  private fail(message: string, extra: Partial<NativeProbeStatus> = {}): void {
    log('error', `Native engine: ${message}`);
    this.update({ state: 'failed', message, ...extra });
  }

  async start(target: Display | undefined): Promise<void> {
    if (this.proc) await this.stop();
    this.stopping = false;
    this.status = { ...IDLE_NATIVE_PROBE };
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

    const rect = physicalBounds(target);
    const args = [
      dll,
      '--x',
      String(rect.x),
      '--y',
      String(rect.y),
      '--width',
      String(rect.width),
      '--height',
      String(rect.height),
      '--topmost',
    ];
    log(
      'info',
      `Native engine: starting "${dotnetPath}" ${dll} on display ${target.id} (${formatPixelRect(rect)} physical, .NET ${runtime})`,
    );
    this.update({
      state: 'starting',
      message: 'Starting the engine…',
      dotnetPath,
      runtime,
      engineDll: dll,
      targetDip: { ...target.bounds },
    });

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(dotnetPath, args, { windowsHide: true, stdio: 'pipe' });
    } catch (err) {
      this.fail(`Could not start dotnet: ${String(err)}`);
      return;
    }
    this.proc = proc;
    this.update({ pid: proc.pid ?? null });

    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.clearTimer();
      this.fail(`Could not start dotnet: ${err.message}`);
    });
    createInterface({ input: proc.stdout }).on('line', (line) => {
      if (this.proc !== proc) return;
      const report = parseEngineLine(line);
      if (report) this.handle(report);
      else if (line.trim()) this.appendStderr(line);
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      if (this.proc === proc) this.appendStderr(chunk);
    });
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.clearTimer();
      const how = code !== null ? `exit code ${code}` : `signal ${String(signal)}`;
      if (this.stopping) {
        log('info', `Native engine: stopped (${how})`);
        this.update({
          state: 'stopped',
          message: 'Test window closed.',
          exitCode: code,
          pid: null,
        });
      } else if (this.status.state !== 'failed') {
        this.fail(
          `The engine exited unexpectedly (${how}). If Smart App Control blocked it, Windows showed a notification and the details below may say so.`,
          { exitCode: code, pid: null },
        );
      } else {
        this.update({ exitCode: code, pid: null });
      }
    });

    this.readyTimer = setTimeout(() => {
      if (this.proc !== proc || this.status.state === 'running') return;
      this.fail(`No response from the engine within ${READY_TIMEOUT_MS / 1000} s; stopping it.`);
      proc.kill();
    }, READY_TIMEOUT_MS);
  }

  private appendStderr(text: string): void {
    const s = (this.status.stderr + text + (text.endsWith('\n') ? '' : '\n')).slice(-STDERR_KEEP);
    this.update({ stderr: s });
  }

  private clearTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private handle(r: EngineReport): void {
    switch (r.type) {
      case 'hello':
        log('info', `Native engine: hello from ${r.engine} ${r.version} on ${r.runtime}, ${r.os}`);
        this.update({ message: `Engine loaded (${r.runtime}); opening its window…` });
        return;
      case 'probe':
        log(
          r.ok ? 'info' : 'warn',
          `Native engine: probe ${r.name} ${r.ok ? 'OK' : 'FAILED'}: ${r.detail}`,
        );
        this.update({
          probes: [...this.status.probes, { name: r.name, ok: r.ok, detail: r.detail }],
        });
        return;
      case 'ready': {
        this.clearTimer();
        const p = r.placement;
        const problems = [
          r.affinity.verified
            ? null
            : `capture exclusion NOT verified (affinity ${r.affinity.actual})`,
          p.exact ? null : `placement mismatch: ${p.problems.join('; ')}`,
          r.dpiAwareness === 'per-monitor v2' ? null : `DPI awareness ${r.dpiAwareness}`,
        ].filter((x): x is string => x !== null);
        const failedProbes = this.status.probes.filter((x) => !x.ok).map((x) => x.name);
        if (failedProbes.length) problems.push(`failed to load: ${failedProbes.join(', ')}`);
        const message = problems.length
          ? `Running, with problems: ${problems.join('; ')}.`
          : 'Running: the black test window covers the projector. Capture exclusion verified, placement exact.';
        log(
          problems.length ? 'warn' : 'info',
          `Native engine: ready; window ${formatPixelRect(p.actual)} (requested ${formatPixelRect(p.requested)}, monitor ${formatPixelRect(p.monitor)}), affinity ${r.affinity.actual}, DPI ${r.dpiAwareness}`,
        );
        this.update({
          state: 'running',
          message,
          dpiAwareness: r.dpiAwareness,
          affinity: { actual: r.affinity.actual, verified: r.affinity.verified },
          placement: p,
        });
        return;
      }
      case 'error':
        this.clearTimer();
        this.fail(`Engine error (${r.stage}): ${r.message}${r.hresult ? ` [${r.hresult}]` : ''}`);
        return;
      case 'bye':
        log('info', `Native engine: bye (${r.reason})`);
        return;
    }
  }

  /** Close the test window: ask nicely over stdin, then kill. */
  stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        proc.kill();
        resolve();
      }, STOP_GRACE_MS);
      proc.once('exit', done);
      try {
        proc.stdin.end('quit\n');
      } catch {
        proc.kill();
      }
    });
  }

  /** App quitting: don't leave the window behind (closing stdin also closes it). */
  dispose(): void {
    this.clearTimer();
    if (this.proc) {
      this.stopping = true;
      this.proc.stdin.end('quit\n');
      const p = this.proc;
      setTimeout(() => p.kill(), STOP_GRACE_MS).unref();
    }
  }
}
