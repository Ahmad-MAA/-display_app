import { useEffect, useState } from 'react';
import type { AppState, PlacementReport } from '@shared/diagnostics';
import { formatRect, isHdrDisplay, type DisplayInfo } from '@shared/displays';
import { HARDWARE_CHECKS, type CheckId, type CheckResult } from './checklist';
import { buildReport, placementSummary, type CheckRecord } from './report';
import { useAppState, useLogs } from './useAppState';

const api = window.projectorDesk;
const CHECKS_KEY = 'projectordesk.hardwareChecks.v1';

function loadChecks(): Record<CheckId, CheckRecord> {
  const empty = Object.fromEntries(
    HARDWARE_CHECKS.map((c) => [c.id, { result: 'untested', snapshot: null }]),
  ) as Record<CheckId, CheckRecord>;
  try {
    const raw = localStorage.getItem(CHECKS_KEY);
    if (!raw) return empty;
    return { ...empty, ...(JSON.parse(raw) as Partial<Record<CheckId, CheckRecord>>) };
  } catch {
    return empty;
  }
}

function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  children: React.ReactNode;
}) {
  const cls = {
    ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    muted: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  }[tone];
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{children}</span>
  );
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const { active, className, ...rest } = props;
  return (
    <button
      {...rest}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition disabled:opacity-40 ${
        active
          ? 'bg-sky-500 text-white ring-sky-400 hover:bg-sky-400'
          : 'bg-slate-800 text-slate-100 ring-slate-700 hover:bg-slate-700'
      } ${className ?? ''}`}
    />
  );
}

function PlacementCard({ p }: { p: PlacementReport | null }) {
  if (!p)
    return <p className="text-sm text-slate-400">The Output window has not been placed yet.</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {p.ok ? (
          <Badge tone="ok">Covers display exactly</Badge>
        ) : (
          <Badge tone="bad">Placement problem</Badge>
        )}
        {p.mixedDpi && (
          <Badge tone="warn">
            Mixed DPI ({p.primaryScaleFactor} → {p.targetScaleFactor})
          </Badge>
        )}
        {p.corrected && (
          <Badge tone="warn">{p.ok ? 'Mismatch corrected' : 'Mismatch detected'}</Badge>
        )}
        <Badge tone="muted">{p.fullScreen ? 'Full screen' : 'Windowed'}</Badge>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-slate-400">Target</dt>
        <dd>
          {p.targetLabel} (id {p.targetDisplayId})
        </dd>
        <dt className="text-slate-400">Expected</dt>
        <dd>{formatRect(p.expected)}</dd>
        <dt className="text-slate-400">Actual</dt>
        <dd className={p.ok ? '' : 'text-rose-300'}>
          {formatRect(p.actual)} on display {p.matchedDisplayId}
        </dd>
        <dt className="text-slate-400">Renderer</dt>
        <dd>
          {p.viewport
            ? `${p.viewport.innerWidth}×${p.viewport.innerHeight} DIP × ${p.viewport.devicePixelRatio}`
            : '—'}
        </dd>
        <dt className="text-slate-400">Attempts</dt>
        <dd>{p.attempts}</dd>
        <dt className="text-slate-400">Placed at</dt>
        <dd>{new Date(p.at).toLocaleTimeString()}</dd>
      </dl>
      {p.problems.length > 0 && (
        <ul className="list-disc pl-5 text-rose-300">
          {p.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DisplaysTable({
  displays,
  targetId,
}: {
  displays: DisplayInfo[];
  targetId: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-400">
          <tr>
            <th className="py-1 pr-3">Display</th>
            <th className="py-1 pr-3">Bounds (DIP)</th>
            <th className="py-1 pr-3">Scale</th>
            <th className="py-1 pr-3">Native px</th>
            <th className="py-1 pr-3">Hz</th>
            <th className="py-1 pr-3">Color</th>
            <th className="py-1 pr-3">Role</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {displays.map((d) => (
            <tr key={d.id} className="border-t border-slate-800">
              <td className="py-1.5 pr-3 font-sans">
                {d.label} <span className="text-slate-500">#{d.id}</span>
              </td>
              <td className="py-1.5 pr-3">{formatRect(d.bounds)}</td>
              <td className="py-1.5 pr-3">{Math.round(d.scaleFactor * 100)}%</td>
              <td className="py-1.5 pr-3">
                {d.nativeSize.width}×{d.nativeSize.height}
              </td>
              <td className="py-1.5 pr-3">{d.displayFrequency}</td>
              <td className="py-1.5 pr-3">
                {d.colorDepth}-bit {d.colorSpace}{' '}
                {isHdrDisplay(d) && <Badge tone="warn">HDR</Badge>}
              </td>
              <td className="py-1.5 pr-3 font-sans">
                {d.isPrimary && <Badge tone="muted">Primary · Control Panel</Badge>}{' '}
                {d.id === targetId && <Badge tone="ok">Projector · Output</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Checklist({
  state,
  checks,
  setChecks,
}: {
  state: AppState;
  checks: Record<CheckId, CheckRecord>;
  setChecks: (c: Record<CheckId, CheckRecord>) => void;
}) {
  const mark = (id: CheckId, result: CheckResult) => {
    setChecks({
      ...checks,
      [id]: { result, snapshot: result === 'untested' ? null : placementSummary(state) },
    });
  };
  return (
    <ul className="space-y-2 text-sm">
      {HARDWARE_CHECKS.map((c) => {
        const r = checks[c.id];
        return (
          <li key={c.id} className="rounded-md border border-slate-800 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{c.label}</span>
              <span className="flex gap-1">
                <Button
                  active={r.result === 'pass'}
                  onClick={() => {
                    mark(c.id, 'pass');
                  }}
                >
                  Pass
                </Button>
                <Button
                  active={r.result === 'fail'}
                  onClick={() => {
                    mark(c.id, 'fail');
                  }}
                >
                  Fail
                </Button>
                <Button
                  onClick={() => {
                    mark(c.id, 'untested');
                  }}
                >
                  Reset
                </Button>
              </span>
            </div>
            {r.snapshot && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">{r.snapshot}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function App() {
  const state = useAppState();
  const logs = useLogs();
  const [checks, setChecksState] = useState(loadChecks);
  const [copied, setCopied] = useState(false);

  const setChecks = (c: Record<CheckId, CheckRecord>) => {
    setChecksState(c);
    try {
      localStorage.setItem(CHECKS_KEY, JSON.stringify(c));
    } catch {
      /* non-essential */
    }
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(t);
    };
  }, [copied]);

  if (!state) return <div className="p-6 text-slate-400">Loading…</div>;

  const cp = state.contentProtection;
  const single = state.displays.length < 2;

  const copyReport = async () => {
    await navigator.clipboard.writeText(buildReport(state, checks, logs));
    setCopied(true);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-5 py-3">
        <h1 className="text-lg font-semibold">ProjectorDesk</h1>
        <Badge tone={state.outputVisible ? 'ok' : 'muted'}>
          Output {state.outputVisible ? 'on projector' : 'hidden'}
        </Badge>
        {cp && (
          <Badge tone={cp.ok ? 'ok' : 'bad'}>
            Capture exclusion {cp.ok ? 'active' : 'UNAVAILABLE'}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            active={state.testPattern}
            disabled={!state.outputVisible}
            onClick={() => void api.setTestPattern(!state.testPattern)}
          >
            Test pattern
          </Button>
          <Button onClick={() => void api.replaceOutput()}>Re-place output</Button>
          <Button onClick={() => void copyReport()}>{copied ? 'Copied ✓' : 'Copy report'}</Button>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto p-5">
        {cp && !cp.ok && (
          <div
            role="alert"
            className="rounded-md border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200"
          >
            <strong>Recursive-mirror protection unavailable.</strong> {cp.message}
          </div>
        )}
        {single && (
          <div
            role="alert"
            className="rounded-md border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200"
          >
            <strong>Projector not detected or set to Duplicate.</strong> Press Win+P and choose
            “Extend”. The Output window will appear automatically.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Output placement">
            <PlacementCard p={state.placement} />
          </Card>
          <Card
            title="Step 1 hardware gate"
            right={<span className="text-xs text-slate-500">saved locally</span>}
          >
            <Checklist state={state} checks={checks} setChecks={setChecks} />
          </Card>
        </div>

        <Card title="Displays">
          <DisplaysTable displays={state.displays} targetId={state.targetDisplayId} />
        </Card>

        <Card title="Log">
          <pre className="max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {logs.map((l) => (
              <div
                key={`${l.at}-${l.message}`}
                className={
                  l.level === 'error'
                    ? 'text-rose-300'
                    : l.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-slate-400'
                }
              >
                {l.at.slice(11, 23)} {l.message}
              </div>
            ))}
          </pre>
        </Card>
      </main>
    </div>
  );
}
