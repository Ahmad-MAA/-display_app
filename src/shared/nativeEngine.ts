/**
 * Phase 2 native engine (C# + Direct3D 11), started as `dotnet ProjectorDesk.Engine.dll` and
 * driven over a named pipe. Pure helpers here; process and pipe handling in
 * src/main/nativeEngineHost.ts.
 */
import type { Rect } from './displays';
import type { EnginePlacement, PhysicalRect } from './outputEngine';

export const DOTNET_MAJOR = 10;
export const DOTNET_DOWNLOAD_URL = 'https://dotnet.microsoft.com/download/dotnet/10.0';

/** Versions of the shared .NET runtime (Microsoft.NETCore.App) in `dotnet --list-runtimes`. */
export function parseNetCoreRuntimes(listOutput: string): string[] {
  const versions: string[] = [];
  for (const line of listOutput.split(/\r?\n/)) {
    const m = /^Microsoft\.NETCore\.App\s+(\d+\.\d+\.\d+\S*)\s/.exec(line.trim() + ' ');
    if (m?.[1]) versions.push(m[1]);
  }
  return versions;
}

/** Newest installed runtime of the given major version, or null. */
export function pickRuntime(versions: readonly string[], major = DOTNET_MAJOR): string | null {
  const parts = (v: string) => v.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const matching = versions.filter((v) => parts(v)[0] === major);
  matching.sort((a, b) => {
    const pa = parts(a);
    const pb = parts(b);
    for (let i = 0; i < 3; i++)
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    // A release sorts after its own previews (10.0.0 > 10.0.0-rc.2).
    return (a.includes('-') ? 0 : 1) - (b.includes('-') ? 0 : 1);
  });
  return matching.at(-1) ?? null;
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}

export type NativeEngineState =
  'idle' | 'checking' | 'starting' | 'connected' | 'placed' | 'hidden' | 'stopped' | 'failed';

export interface NativeEngineStatus {
  state: NativeEngineState;
  /** One line for the panel: what happened or what to do. */
  message: string;
  dotnetPath: string | null;
  runtime: string | null;
  engineDll: string | null;
  pid: number | null;
  pipe: string | null;
  /** From the engine's hello, once the pipe handshake succeeded. */
  engine: { version: string; runtime: string; os: string; protocol: number } | null;
  probes: ProbeResult[];
  dpiAwareness: string | null;
  affinity: { actual: string; verified: boolean } | null;
  placement: EnginePlacement | null;
  /** Electron display the engine was last placed on, and its DIP bounds (for the report). */
  targetDisplayId: number | null;
  targetDip: Rect | null;
  /** Successful placements this run (first show + every re-place on a display change). */
  placements: number;
  /** Times the window came back, exactly placed, after its display was unplugged. */
  hotplugRecoveries: number;
  lastHeartbeatAt: string | null;
  exitCode: number | null;
  /** Last lines the process wrote to stderr / stdout (runtime or loader errors). */
  stderr: string;
  at: string;
}

export const IDLE_NATIVE_ENGINE: NativeEngineStatus = {
  state: 'idle',
  message: 'Not started.',
  dotnetPath: null,
  runtime: null,
  engineDll: null,
  pid: null,
  pipe: null,
  engine: null,
  probes: [],
  dpiAwareness: null,
  affinity: null,
  placement: null,
  targetDisplayId: null,
  targetDip: null,
  placements: 0,
  hotplugRecoveries: 0,
  lastHeartbeatAt: null,
  exitCode: null,
  stderr: '',
  at: '',
};

export const formatPixelRect = (r: PhysicalRect): string =>
  `${r.width}×${r.height} @ (${r.x}, ${r.y})`;
