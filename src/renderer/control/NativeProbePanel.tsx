import { DOTNET_DOWNLOAD_URL, formatPixelRect, type NativeProbeStatus } from '@shared/nativeEngine';

const api = window.projectorDesk;

const TONE: Record<NativeProbeStatus['state'], string> = {
  idle: 'text-slate-400',
  checking: 'text-sky-300',
  starting: 'text-sky-300',
  running: 'text-emerald-300',
  stopped: 'text-slate-300',
  failed: 'text-rose-300',
};

/** P2.0: can the native engine run on this PC (Smart App Control), and does its window land right? */
export function NativeProbePanel({ status }: { status: NativeProbeStatus }) {
  const busy = status.state === 'checking' || status.state === 'starting';
  const live = status.state === 'running' || busy;
  const p = status.placement;
  const needsDotnet = status.state === 'failed' && status.message.includes(DOTNET_DOWNLOAD_URL);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-400">
        Starts the Phase 2 engine (<code>dotnet ProjectorDesk.Engine.dll</code>). It opens a plain
        black window over the projector, on top of the current Output, and reports what it could
        load. Close it with the button below.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          disabled={busy}
          onClick={() => void api.startNativeProbe()}
        >
          {status.state === 'running' ? 'Restart test window' : 'Launch test window'}
        </button>
        <button
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-40"
          disabled={!live}
          onClick={() => void api.stopNativeProbe()}
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
        {status.runtime && (
          <>
            <dt className="text-slate-500">.NET</dt>
            <dd>
              {status.runtime} via {status.dotnetPath}
            </dd>
          </>
        )}
        {status.pid !== null && (
          <>
            <dt className="text-slate-500">pid</dt>
            <dd>{status.pid}</dd>
          </>
        )}
        {status.probes.map((x) => (
          <div key={x.name} className="contents">
            <dt className="text-slate-500">{x.name}</dt>
            <dd className={x.ok ? 'text-emerald-300' : 'text-rose-300'}>
              {x.ok ? '✓' : '✗'} {x.detail}
            </dd>
          </div>
        ))}
        {status.dpiAwareness && (
          <>
            <dt className="text-slate-500">DPI</dt>
            <dd>{status.dpiAwareness}</dd>
          </>
        )}
        {status.affinity && (
          <>
            <dt className="text-slate-500">capture excl.</dt>
            <dd className={status.affinity.verified ? 'text-emerald-300' : 'text-rose-300'}>
              {status.affinity.verified ? '✓ verified' : '✗ NOT verified'} (affinity{' '}
              {status.affinity.actual})
            </dd>
          </>
        )}
        {p && (
          <>
            <dt className="text-slate-500">placement</dt>
            <dd className={p.exact ? 'text-emerald-300' : 'text-rose-300'}>
              {p.exact ? '✓ exact' : `✗ ${p.problems.join('; ')}`} · window{' '}
              {formatPixelRect(p.actual)}
            </dd>
          </>
        )}
        {status.exitCode !== null && (
          <>
            <dt className="text-slate-500">exit code</dt>
            <dd>{status.exitCode}</dd>
          </>
        )}
      </dl>
      {status.stderr && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-rose-200">
          {status.stderr}
        </pre>
      )}
    </div>
  );
}
