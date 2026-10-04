import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { log } from './log';

/**
 * Resolves HWND → process name without a native module: one long-lived PowerShell
 * process P/Invokes GetWindowThreadProcessId. Requests are newline-delimited lists of
 * HWNDs; each response is one JSON line { "<hwnd>": "<name>" | null }.
 *
 * Results are cached per HWND (a window never changes process). Any failure disables
 * the resolver for the session and names fall back to null; nothing else depends on it.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PdWin {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $out = @{}
  foreach ($h in $line.Split(',')) {
    if (-not $h) { continue }
    $procId = [uint32]0
    $name = $null
    try {
      [void][PdWin]::GetWindowThreadProcessId([IntPtr][long]$h, [ref]$procId)
      if ($procId -ne 0) { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName }
    } catch { $name = $null }
    $out[$h] = $name
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress))
  [Console]::Out.Flush()
}
`;

const REQUEST_TIMEOUT_MS = 5000;
const STARTUP_TIMEOUT_MS = 15000;

type Pending = { resolve: (m: Record<string, string | null>) => void; timer: NodeJS.Timeout };

export class ProcessNameResolver {
  private readonly cache = new Map<string, string | null>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<boolean> | null = null;
  private queue: Pending[] = [];
  private disabled = process.platform !== 'win32';

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

      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(
          'powershell.exe',
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
        log('warn', `Process-name helper: ${text.slice(0, 300)}`);
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
          pending.resolve(JSON.parse(line) as Record<string, string | null>);
        } catch {
          pending.resolve({});
        }
      });
    });
    return this.ready;
  }

  private fail(reason: string): void {
    if (this.disabled) return;
    this.disabled = true;
    log('warn', `Process names unavailable (${reason}); sources will show titles only`);
    for (const p of this.queue) {
      clearTimeout(p.timer);
      p.resolve({});
    }
    this.queue = [];
    this.child?.kill();
    this.child = null;
  }

  private request(hwnds: string[]): Promise<Record<string, string | null>> {
    const child = this.child;
    if (!child) return Promise.resolve({});
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.fail('request timed out');
      }, REQUEST_TIMEOUT_MS);
      this.queue.push({ resolve, timer });
      child.stdin.write(hwnds.join(',') + '\n');
    });
  }

  /** Names for the given HWNDs (null when unknown). Never throws. */
  async resolve(hwnds: readonly string[]): Promise<Map<string, string | null>> {
    if (this.cache.size > 2000) {
      const keep = new Set(hwnds);
      for (const h of this.cache.keys()) if (!keep.has(h)) this.cache.delete(h);
    }
    const missing = hwnds.filter((h) => !this.cache.has(h));
    if (missing.length > 0 && !this.disabled && (await this.start())) {
      const result = await this.request(missing);
      for (const h of missing) {
        if (h in result) this.cache.set(h, result[h] ?? null);
      }
    }
    return new Map(hwnds.map((h) => [h, this.cache.get(h) ?? null]));
  }

  dispose(): void {
    this.disabled = true;
    this.child?.kill();
    this.child = null;
  }
}
