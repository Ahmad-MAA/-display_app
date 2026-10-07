import {
  DOTNET_DOWNLOAD_URL,
  formatPixelRect,
  type NativeEngineStatus,
} from '@shared/nativeEngine';

const api = window.projectorDesk;

const TONE: Record<NativeEngineStatus['state'], string> = {
  idle: 'text-slate-400',
  checking: 'text-sky-300',
  starting: 'text-sky-300',
  connected: 'text-sky-300',
  placed: 'text-emerald-300',
  hidden: 'text-amber-300',
  stopped: 'text-slate-300',
  failed: 'text-rose-300',
};

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: string }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={tone}>{children}</dd>
    </>
  );
}

/**
 * Phase 2 native engine (P2.1): started with `dotnet`, connected over the named pipe, its black
 * test window placed on the projector and moved with every display change.
 */
export function NativeEnginePanel({ status }: { status: NativeEngineStatus }) {
  const busy = ['checking', 'starting', 'connected'].includes(status.state);
  const live = busy || status.state === 'placed' || status.state === 'hidden';
  const p = status.placement;
  const needsDotnet = status.state === 'failed' && status.message.includes(DOTNET_DOWNLOAD_URL);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-400">
        Starts the Phase 2 engine (<code>dotnet ProjectorDesk.Engine.dll</code>) and connects to it
        over a private named pipe. Its plain black test window covers the projector, on top of the
        current Output, and follows display changes like the Output does. Close it with the button
        below.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          disabled={busy}
          onClick={() => void api.startNativeEngine()}
        >
          {live ? 'Restart test window' : 'Launch test window'}
        </button>
        <button
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-40"
          disabled={!live}
          onClick={() => void api.stopNativeEngine()}
        >
          Close test window
        </button>
      </div>
      <p className={TONE[status.state]}>
        <strong className="uppercase">{status.state}</strong> · {status.message}
      </p>
      {needsDotnet && (
        <a
          className="text-sky-300 underline"
          href={DOTNET_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
        >
          Download .NET 10 (choose the x64 “.NET Runtime” installer)
        </a>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-300">
        {status.engine && (
          <Row k="engine">
            {status.engine.version} · protocol v{status.engine.protocol} · {status.engine.runtime}
          </Row>
        )}
        {status.pid !== null && (
          <Row k="process">
            pid {status.pid} · pipe {status.pipe}
          </Row>
        )}
        {status.probes.map((x) => (
          <Row key={x.name} k={x.name} tone={x.ok ? 'text-emerald-300' : 'text-rose-300'}>
            {x.ok ? '✓' : '✗'} {x.detail}
          </Row>
        ))}
        {status.dpiAwareness && <Row k="DPI">{status.dpiAwareness}</Row>}
        {status.affinity && (
          <Row
            k="capture excl."
            tone={status.affinity.verified ? 'text-emerald-300' : 'text-rose-300'}
          >
            {status.affinity.verified ? '✓ verified' : '✗ NOT verified'} (affinity{' '}
            {status.affinity.actual})
          </Row>
        )}
        {p && (
          <Row k="placement" tone={p.exact ? 'text-emerald-300' : 'text-rose-300'}>
            {p.exact ? '✓ exact' : `✗ ${p.problems.join('; ')}`} · window{' '}
            {formatPixelRect(p.actual)}
            {p.notes.length > 0 && <span className="text-slate-400"> · {p.notes.join('; ')}</span>}
          </Row>
        )}
        {status.placements > 0 && (
          <Row k="placements">
            {status.placements} (back after unplug: {status.hotplugRecoveries})
          </Row>
        )}
        {status.lastHeartbeatAt && (
          <Row k="heartbeat">{new Date(status.lastHeartbeatAt).toLocaleTimeString()}</Row>
        )}
        {status.exitCode !== null && <Row k="exit code">{status.exitCode}</Row>}
      </dl>
      {status.stderr && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-rose-200">
          {status.stderr}
        </pre>
      )}
    </div>
  );
}
