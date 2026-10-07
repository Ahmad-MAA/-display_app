/**
 * Phase 2 native engine (C# + Direct3D 11), started as `dotnet ProjectorDesk.Engine.dll`.
 * P2.0: a feasibility probe that opens the engine's black window on the projector and reports
 * what loaded. Pure helpers here; process handling in src/main/nativeProbe.ts.
 */
import type { Rect } from './displays';

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

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Lines the engine writes on stdout in P2.0 (one JSON object per line). */
export type EngineReport =
  | {
      type: 'hello';
      engine: string;
      version: string;
      report: number;
      runtime: string;
      os: string;
      selfTest: boolean;
    }
  | ({ type: 'probe' } & ProbeResult)
  | {
      type: 'ready';
      dpiAwareness: string;
      affinity: { requested: string; actual: string; verified: boolean };
      placement: {
        requested: PixelRect;
        actual: PixelRect;
        monitor: PixelRect;
        exact: boolean;
        problems: string[];
      };
    }
  | { type: 'error'; stage: string; message: string; hresult?: string }
  | { type: 'bye'; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse one stdout line; anything that isn't a known report (e.g. runtime noise) is null. */
export function parseEngineLine(line: string): EngineReport | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v['type'] !== 'string') return null;
  switch (v['type']) {
    case 'hello':
    case 'probe':
    case 'ready':
    case 'error':
    case 'bye':
      return v as EngineReport;
    default:
      return null;
  }
}

export type NativeProbeState = 'idle' | 'checking' | 'starting' | 'running' | 'stopped' | 'failed';

export interface NativeProbeStatus {
  state: NativeProbeState;
  /** One line for the panel: what happened or what to do. */
  message: string;
  dotnetPath: string | null;
  runtime: string | null;
  engineDll: string | null;
  pid: number | null;
  probes: ProbeResult[];
  dpiAwareness: string | null;
  affinity: { actual: string; verified: boolean } | null;
  placement: {
    requested: PixelRect;
    actual: PixelRect;
    monitor: PixelRect;
    exact: boolean;
    problems: string[];
  } | null;
  /** Target display in DIPs, for the report. */
  targetDip: Rect | null;
  exitCode: number | null;
  /** Last lines the process wrote to stderr (runtime or loader errors). */
  stderr: string;
  at: string;
}

export const IDLE_NATIVE_PROBE: NativeProbeStatus = {
  state: 'idle',
  message: 'Not run yet.',
  dotnetPath: null,
  runtime: null,
  engineDll: null,
  pid: null,
  probes: [],
  dpiAwareness: null,
  affinity: null,
  placement: null,
  targetDip: null,
  exitCode: null,
  stderr: '',
  at: '',
};

export const formatPixelRect = (r: PixelRect): string =>
  `${r.width}×${r.height} @ (${r.x}, ${r.y})`;
