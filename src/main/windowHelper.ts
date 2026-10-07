import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Rect } from '@shared/displays';
import type { WinInfo } from '@shared/follow';
import type { MinimizedWindow } from '@shared/sources';
import { log } from './log';
import { WINDOW_HELPER_SCRIPT } from './windowHelper.ps1';

/**
 * Native window queries without a native Node module: one long-lived, hidden
 * PowerShell process (script in windowHelper.ps1.ts) answers JSON requests line by line.
 *
 * - processNames(): HWND → process name (cached per HWND; a window never changes process)
 * - minimized():    minimized top-level app windows, which Electron's getSources() omits
 *
 * If PowerShell can't start or stops answering, the helper disables itself for the
 * session, logs once, and callers get empty results; enumeration still works without it.
 */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Windows caps a command line at 32,767 characters. Passing the whole script with
 * -EncodedCommand (UTF-16 → base64, ~2.7× its size) broke once it grew past ~12 KB
 * (spawn ENAMETOOLONG on hardware). Instead the script is written to a file and a tiny
 * bootstrap runs it as a ScriptBlock, which, unlike `-File`, isn't subject to the
 * execution policy (some managed PCs enforce AllSigned).
 */
export function bootstrapCommand(scriptPath: string): string {
  const quoted = scriptPath.replace(/'/g, "''");
  return `& ([ScriptBlock]::Create([IO.File]::ReadAllText('${quoted}')))`;
}

export function encodePowerShell(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}

export const MAX_WINDOWS_COMMAND_LINE = 32767;

function toRect(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === 'number' ? r[k] : NaN);
  const rect = { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
  return Object.values(rect).every(Number.isFinite) ? rect : null;
}

/** Validate one window record from the helper; null if malformed. */
function toWinInfo(v: unknown): WinInfo | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  if (typeof w['hwnd'] !== 'string') return null;
  const str = (k: string) => (typeof w[k] === 'string' ? w[k] : '');
  const bool = (k: string) => w[k] === true;
  const pn = str('processName');
  return {
    hwnd: w['hwnd'],
    pid: typeof w['pid'] === 'number' ? w['pid'] : 0,
    processName: pn === '' ? null : pn,
    title: str('title'),
    className: str('className'),
    exists: bool('exists'),
    visible: bool('visible'),
    minimized: bool('minimized'),
    maximized: bool('maximized'),
    cloaked: bool('cloaked'),
    owned: bool('owned'),
    fullscreen: bool('fullscreen'),
    topmost: bool('topmost'),
    layered: bool('layered'),
    transparent: bool('transparent'),
    toolWindow: bool('toolWindow'),
    noActivate: bool('noActivate'),
    exStyle: str('exStyle'),
    coverage: typeof w['coverage'] === 'number' ? w['coverage'] : 0,
    rect: toRect(w['rect']),
    monitor: toRect(w['monitor']),
  };
}

function toWinList(v: unknown): WinInfo[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map(toWinInfo).filter((w): w is WinInfo => w !== null);
}
const STARTUP_TIMEOUT_MS = 15000;

type Response = { ok: true; result: unknown } | { ok: false; error: string };
type Pending = { resolve: (r: Response | null) => void; timer: NodeJS.Timeout };

export class WindowHelper {
  private readonly nameCache = new Map<string, string | null>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<boolean> | null = null;
  private queue: Pending[] = [];
  private disabled: boolean;
  private lastOpError: string | null = null;
  private readonly exe: string;
  private readonly scriptDir: string;
  private failure: string | null = null;

  /**
   * `scriptDir`: where the helper script is written (userData). `exe` is overridable so
   * the protocol can be exercised with pwsh off Windows.
   */
  constructor(opts: { scriptDir: string; exe?: string }) {
    this.exe = opts.exe ?? 'powershell.exe';
    this.scriptDir = opts.scriptDir;
    this.disabled = opts.exe === undefined && process.platform !== 'win32';
    if (this.disabled) this.failure = 'only available on Windows';
  }

  /** Why the helper is off (null while it works or hasn't been needed yet). */
  get unavailableReason(): string | null {
    return this.failure;
  }

  /** Called once if the helper stops working, so the UI can say so. */
  onUnavailable: ((reason: string) => void) | null = null;

  get available(): boolean {
    return !this.disabled;
  }

  private start(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimer);
          resolve(ok);
        }
      };
      const startTimer = setTimeout(() => {
        this.fail('PowerShell helper did not start in time');
        done(false);
      }, STARTUP_TIMEOUT_MS);

      let encoded: string;
      try {
        mkdirSync(this.scriptDir, { recursive: true });
        const scriptPath = join(this.scriptDir, 'window-helper.ps1');
        writeFileSync(scriptPath, WINDOW_HELPER_SCRIPT, 'utf8');
        encoded = encodePowerShell(bootstrapCommand(scriptPath));
      } catch (err) {
        this.fail(`could not write the helper script: ${String(err)}`);
        done(false);
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(
          this.exe,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-EncodedCommand',
            encoded,
          ],
          { windowsHide: true },
        );
      } catch (err) {
        this.fail(`could not start PowerShell: ${String(err)}`);
        done(false);
        return;
      }
      this.child = child;
      child.on('error', (err) => {
        this.fail(`PowerShell error: ${err.message}`);
        done(false);
      });
      child.on('exit', (code) => {
        if (!this.disabled) this.fail(`PowerShell exited (${String(code)})`);
        done(false);
      });
      child.stderr.on('data', (d: Buffer) => {
        const text = d.toString().trim();
        // Redirected PowerShell emits progress records as CLIXML on stderr; not errors.
        if (!text || text.includes('CLIXML') || text.startsWith('<Objs')) return;
        log('warn', `Window helper: ${text.slice(0, 300)}`);
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line === 'READY') {
          done(true);
          return;
        }
        const pending = this.queue.shift();
        if (!pending) return;
        clearTimeout(pending.timer);
        try {
          pending.resolve(JSON.parse(line) as Response);
        } catch {
          pending.resolve(null);
        }
      });
    });
    return this.ready;
  }

  private fail(reason: string): void {
    if (this.disabled) return;
    this.disabled = true;
    this.failure = reason;
    this.onUnavailable?.(reason);
    log(
      'warn',
      `Window helper unavailable (${reason}); process names and minimized windows won't be listed`,
    );
    for (const p of this.queue) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    this.queue = [];
    this.child?.kill();
    this.child = null;
  }

  /** Sends one request; null on any failure. Never throws. */
  private async request(payload: object): Promise<unknown> {
    if (this.disabled || !(await this.start())) return null;
    const child = this.child;
    if (!child) return null;
    const res = await new Promise<Response | null>((resolve) => {
      const timer = setTimeout(() => {
        this.fail('request timed out');
      }, REQUEST_TIMEOUT_MS);
      this.queue.push({ resolve, timer });
      child.stdin.write(JSON.stringify(payload) + '\n');
    });
    if (!res) return null;
    if (!res.ok) {
      // A single failed query (e.g. a window vanished mid-call) is not fatal; log once per message.
      if (res.error !== this.lastOpError) log('warn', `Window helper query failed: ${res.error}`);
      this.lastOpError = res.error;
      return null;
    }
    return res.result;
  }

  /** Process names for the given HWNDs (null when unknown). */
  async processNames(hwnds: readonly string[]): Promise<Map<string, string | null>> {
    if (this.nameCache.size > 2000) {
      const keep = new Set(hwnds);
      for (const h of this.nameCache.keys()) if (!keep.has(h)) this.nameCache.delete(h);
    }
    const missing = hwnds.filter((h) => !this.nameCache.has(h));
    if (missing.length > 0) {
      const result = await this.request({ op: 'names', hwnds: missing });
      if (result && typeof result === 'object') {
        const names = result as Record<string, unknown>;
        for (const h of missing) {
          if (h in names) {
            const n = names[h];
            this.nameCache.set(h, typeof n === 'string' && n !== '' ? n : null);
          }
        }
      }
    }
    return new Map(hwnds.map((h) => [h, this.nameCache.get(h) ?? null]));
  }

  /** Minimized top-level app windows (empty when unavailable). */
  async minimized(): Promise<MinimizedWindow[]> {
    const result = await this.request({ op: 'minimized' });
    if (!Array.isArray(result)) return [];
    const out: MinimizedWindow[] = [];
    for (const item of result as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const w = item as Record<string, unknown>;
      if (typeof w['hwnd'] !== 'string' || typeof w['title'] !== 'string') continue;
      const pn = w['processName'];
      out.push({
        hwnd: w['hwnd'],
        title: w['title'],
        processName: typeof pn === 'string' && pn !== '' ? pn : null,
      });
      if (typeof pn === 'string' && pn !== '') this.nameCache.set(w['hwnd'], pn);
    }
    return out;
  }

  /**
   * Restore a minimized window without activating it (see the script). Resolves
   * restored=false when the helper is unavailable or the window is gone.
   */
  async restore(hwnd: string): Promise<{ restored: boolean; activated: boolean }> {
    const result = await this.request({ op: 'restore', hwnd });
    if (!result || typeof result !== 'object') return { restored: false, activated: false };
    const r = result as Record<string, unknown>;
    return { restored: r['restored'] === true, activated: r['activated'] === true };
  }

  /** The projected window's state plus same-process full-screen windows (null if unavailable). */
  async follow(hwnd: string): Promise<{ target: WinInfo; fullscreen: WinInfo[] } | null> {
    const result = await this.request({ op: 'follow', hwnd });
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    const target = toWinInfo(r['target']);
    return target ? { target, fullscreen: toWinList(r['fullscreen']) } : null;
  }

  /** Windows above `outputHwnd` covering ≥25% of its monitor, topmost first. */
  async covering(outputHwnd: string): Promise<WinInfo[]> {
    return toWinList(await this.request({ op: 'covering', hwnd: outputHwnd }));
  }

  /** Foreground window + the target thread's active/focus/caret state (null if unavailable). */
  async focus(hwnd: string): Promise<Record<string, unknown> | null> {
    const r = await this.request({ op: 'focus', hwnd });
    return r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
  }

  /** Diagnostics: every top-level window of the process owning `hwnd`. */
  async inspect(hwnd: string): Promise<WinInfo[]> {
    return toWinList(await this.request({ op: 'inspect', hwnd }));
  }

  dispose(): void {
    this.disabled = true;
    this.child?.kill();
    this.child = null;
  }
}
