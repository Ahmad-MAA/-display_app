import { useEffect, useState } from 'react';
import type { AppState, ExtendResult, PlacementReport } from '@shared/diagnostics';
import { localAction } from '@shared/controls';
import { formatRect, isHdrDisplay, shortColorSpace, type DisplayInfo } from '@shared/displays';
import { HARDWARE_CHECKS, passBlocker, type CheckId, type CheckResult } from './checklist';
import { buildReport, placementSummary, type CheckRecord } from './report';
import { NowProjecting } from './NowProjecting';
import { SourcesPanel, useSources } from './SourcesPanel';
import { useAppState, useLogs } from './useAppState';

const api = window.projectorDesk;
// v3: step-1 results are archived in docs/HARDWARE_GATE.md; step 2 re-tests hot-plug.
const CHECKS_KEY = 'projectordesk.hardwareChecks.v3';

const UNTESTED: CheckRecord = { result: 'untested', snapshot: null };

function loadChecks(): Record<CheckId, CheckRecord> {
  const empty: Record<CheckId, CheckRecord> = Object.fromEntries(
    HARDWARE_CHECKS.map((c) => [c.id, UNTESTED]),
  );
  try {
    const raw = localStorage.getItem(CHECKS_KEY);
    if (!raw) return empty;
    return { ...empty, ...(JSON.parse(raw) as Record<CheckId, CheckRecord>) };
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

function displayOptionLabel(d: DisplayInfo): string {
  return `${d.label} — ${d.nativeSize.width}×${d.nativeSize.height} px · ${Math.round(d.scaleFactor * 100)}% · ${d.colorDepth}-bit ${shortColorSpace(d.colorSpace)}`;
}

function ProjectorPicker({ state }: { state: AppState }) {
  const secondaries = state.displays.filter((d) => !d.isPrimary);
  const primary = state.displays.find((d) => d.isPrimary);
  const target = state.displays.find((d) => d.id === state.targetDisplayId);
  const value = state.preferredDisplayId === null ? 'auto' : String(state.preferredDisplayId);
  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs text-slate-400">Projector display</span>
        <select
          className="w-full rounded-md bg-slate-800 px-2 py-1.5 ring-1 ring-slate-700"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            void api.setTargetDisplay(v === 'auto' ? null : Number(v));
          }}
        >
          <option value="auto">Automatic (first non-primary display)</option>
          {secondaries.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {displayOptionLabel(d)}
            </option>
          ))}
          {primary && (
            <option disabled value={String(primary.id)}>
              {displayOptionLabel(primary)} (primary — Control Panel)
            </option>
          )}
        </select>
      </label>
      {target ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.outputVisible ? 'ok' : 'muted'}>
            {state.outputVisible ? 'Output on' : 'Output hidden for'} {target.label}
          </Badge>
          <Badge tone="muted">
            {target.bounds.width}×{target.bounds.height} DIP · {target.displayFrequency} Hz
          </Badge>
          {primary && primary.scaleFactor !== target.scaleFactor && (
            <Badge tone="warn">
              DPI mismatch: primary {Math.round(primary.scaleFactor * 100)}%, projector{' '}
              {Math.round(target.scaleFactor * 100)}% — placement verified per display
            </Badge>
          )}
          {isHdrDisplay(target) && <Badge tone="warn">HDR display</Badge>}
        </div>
      ) : (
        <p className="text-slate-400">No projector display selected.</p>
      )}
    </div>
  );
}

function DisplayBanners({ state }: { state: AppState }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtendResult | null>(null);
  const single = state.displays.length < 2;
  const lost = state.lostDisplayId !== null;
  const p = state.placement;

  const extend = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.extendDisplays());
    } catch (err) {
      setResult({ ok: false, displayCount: state.displays.length, message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {(single || lost) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200"
        >
          <span className="flex-1">
            {lost ? (
              <>
                <strong>Projector disconnected.</strong> The Output is hidden and will come back
                automatically when the display is reconnected
                {single ? ' (in Extend mode)' : ''}.
              </>
            ) : (
              <>
                <strong>Projector not detected or set to Duplicate.</strong> Connect the projector
                and switch Windows to Extend (Win+P → Extend).
              </>
            )}
          </span>
          {single && (
            <Button disabled={busy} onClick={() => void extend()}>
              {busy ? 'Switching…' : 'Switch to Extend'}
            </Button>
          )}
          {lost && !single && (
            <Button onClick={() => void api.setTargetDisplay(null)}>Use another display</Button>
          )}
          {result && (
            <span className={`w-full ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {result.message}
            </span>
          )}
        </div>
      )}
      {result?.ok && !single && !lost && (
        <div className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          {result.message}
        </div>
      )}
      {state.outputHiddenByUser && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200"
        >
          <span className="flex-1">
            <strong>Output hidden.</strong> The projector shows the desktop behind it. Press Esc
            here or Ctrl+Alt+H anywhere to bring it back.
          </span>
          <Button onClick={() => void api.action('hide-output')}>Show Output</Button>
        </div>
      )}
      {state.displays.some((d) => isHdrDisplay(d)) && (
        <div className="rounded-md border border-sky-800 bg-sky-950/50 p-3 text-sm text-sky-200">
          <strong>HDR source/display detected.</strong> Phase 1 output is SDR (tone-mapped). Native
          engine required for HDR passthrough.
        </div>
      )}
      {state.windowHelper.supported && state.windowHelper.reason && (
        <div
          role="alert"
          className="rounded-md border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200"
        >
          <strong>Window helper unavailable.</strong> Process names, minimized windows, Follow full
          screen and the “covering the projector” warning are off. Projecting still works.
          <span className="mt-1 block font-mono text-xs text-amber-200/80">
            {state.windowHelper.reason}
          </span>
        </div>
      )}
      {state.coveredBy.length > 0 && state.outputVisible && (
        <div
          role="alert"
          className="rounded-md border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200"
        >
          <strong>Another window is covering the projector.</strong> The audience sees{' '}
          {state.coveredBy
            .map(
              (w) =>
                `“${w.title}”${w.processName ? ` (${w.processName}` : ' ('}${w.topmost ? ', always on top' : ''}${w.fullscreen ? ', full screen' : ''})`,
            )
            .join(', ')}{' '}
          instead of what you pick here.
          <span className="mt-1 block text-rose-200/80">
            Slide shows (WPS, PowerPoint): play the slide show on Monitor 1 and turn Presenter View
            off, then project it from here. Otherwise move or close that window.
          </span>
        </div>
      )}
      {p && !p.ok && state.outputVisible && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200"
        >
          <span className="flex-1">
            <strong>The Output does not exactly cover the projector.</strong>{' '}
            {p.problems.join('; ')}
          </span>
          <Button onClick={() => void api.replaceOutput()}>Re-place output</Button>
        </div>
      )}
    </>
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
                {d.colorDepth}-bit {shortColorSpace(d.colorSpace)}{' '}
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
    // Re-clicking the current result must not overwrite the evidence recorded with it.
    if (result !== 'untested' && checks[id]?.result === result) return;
    setChecks({
      ...checks,
      [id]: { result, snapshot: result === 'untested' ? null : placementSummary(state) },
    });
  };
  return (
    <ul className="space-y-2 text-sm">
      {HARDWARE_CHECKS.map((c) => {
        const r = checks[c.id] ?? UNTESTED;
        const blocker = passBlocker(c.id, state);
        return (
          <li key={c.id} className="rounded-md border border-slate-800 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{c.label}</span>
              <span className="flex gap-1">
                <Button
                  active={r.result === 'pass'}
                  disabled={blocker !== null && r.result !== 'pass'}
                  title={blocker ?? 'Current layout demonstrates this item'}
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
            {r.result === 'untested' && (
              <p
                className={`mt-1 text-[11px] ${blocker ? 'text-amber-300/80' : 'text-emerald-300/80'}`}
              >
                {blocker
                  ? `Set up: ${blocker}`
                  : (c.note?.(state) ?? 'Current layout matches — check the projector, then mark.')}
              </p>
            )}
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
  const sourceList = useSources();
  const [view, setView] = useState<'sources' | 'diagnostics'>('sources');
  const [notice, setNotice] = useState<{ tone: 'warn' | 'bad'; text: string } | null>(null);
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

  // Presenter keys while the Control Panel is focused (global Ctrl+Alt hotkeys work everywhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))
        return;
      if (document.querySelector('[role="dialog"]')) return; // crop editor owns its keys
      const a = localAction(e);
      if (!a) return;
      e.preventDefault();
      void api.action(a);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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

  const pick = async (sourceId: string) => {
    setNotice(null);
    try {
      const r = await api.project(sourceId);
      if (r.message) setNotice({ tone: r.ok ? 'warn' : 'bad', text: r.message });
    } catch (err) {
      setNotice({ tone: 'bad', text: `Couldn’t project: ${String(err)}` });
    }
  };

  const copyReport = async () => {
    await navigator.clipboard.writeText(buildReport(state, checks, logs, sourceList));
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
        <DisplayBanners state={state} />

        <nav className="flex gap-4 border-b border-slate-800 text-sm">
          {(['sources', 'diagnostics'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
              }}
              className={`-mb-px border-b-2 px-1 pb-2 ${
                view === v
                  ? 'border-sky-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'sources' ? 'Sources' : 'Diagnostics'}
            </button>
          ))}
        </nav>

        {view === 'sources' && (
          <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
            <SourcesPanel
              list={sourceList}
              protection={cp}
              projection={state.projection}
              onPick={(id) => void pick(id)}
            />
            <div className="space-y-4">
              <Card title="Now projecting">
                <NowProjecting
                  projection={state.projection}
                  notice={notice}
                  followFullscreen={state.followFullscreen}
                  display={state.display}
                  state={state}
                />
              </Card>
              <Card title="Projector">
                <ProjectorPicker state={state} />
              </Card>
            </div>
          </div>
        )}

        {view === 'diagnostics' && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Output placement">
                <PlacementCard p={state.placement} />
              </Card>
              <Card
                title="Hardware checks"
                right={<span className="text-xs text-slate-500">saved locally</span>}
              >
                <Checklist state={state} checks={checks} setChecks={setChecks} />
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Global hotkeys">
                <ul className="space-y-1 text-xs">
                  {state.hotkeys.map((h) => (
                    <li key={h.action} className="flex justify-between gap-2">
                      <span className="font-mono">
                        {h.accelerator.replace('CommandOrControl', 'Ctrl')}
                      </span>
                      <span className={h.registered ? 'text-emerald-300' : 'text-rose-300'}>
                        {h.action} · {h.registered ? 'active' : 'taken by another app'}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Recent sessions (Phase 2 evidence)">
                {state.sessions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    A session is summarized when a projection ends. Saved to logs/sessions.jsonl.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {state.sessions.map((s) => (
                      <li
                        key={s.startedAt}
                        className={s.needsNativeEngine ? 'text-amber-300' : 'text-slate-300'}
                      >
                        {s.source.slice(0, 40)} · {s.durationS}s · {s.dropPercent.toFixed(1)}%
                        dropped ·{' '}
                        {s.medianLatencyMs === null
                          ? 'latency n/a'
                          : `${s.medianLatencyMs.toFixed(1)} ms`}
                        {s.needsNativeEngine && ` · needs native engine (${s.reasons.join('; ')})`}
                      </li>
                    ))}
                  </ul>
                )}
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
          </>
        )}
      </main>
    </div>
  );
}
