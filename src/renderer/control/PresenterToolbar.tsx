import { DEFAULT_HOTKEYS, prettyAccelerator, type PresenterAction } from '@shared/controls';
import type { AppState } from '@shared/diagnostics';

const api = window.projectorDesk;

function keysFor(action: PresenterAction, hotkeys: AppState['hotkeys']): string {
  const h = DEFAULT_HOTKEYS.find((x) => x.action === action);
  if (!h) return '';
  const global = hotkeys.find((x) => x.action === action);
  const g = prettyAccelerator(global?.accelerator ?? h.global);
  return `${h.local} · ${global && !global.registered ? `${g} (unavailable)` : g}`;
}

function Toggle({
  label,
  on,
  action,
  state,
  danger,
}: {
  label: string;
  on: boolean;
  action: PresenterAction;
  state: AppState;
  danger?: boolean;
}) {
  return (
    <button
      aria-pressed={on}
      title={`${label} (${keysFor(action, state.hotkeys)})`}
      onClick={() => void api.action(action)}
      className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
        on
          ? danger
            ? 'bg-rose-600 text-white ring-rose-500'
            : 'bg-sky-600 text-white ring-sky-500'
          : 'bg-slate-800 ring-slate-700 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

const fmt = (v: number | null, unit: string) => (v === null ? 'n/a' : `${v.toFixed(1)} ${unit}`);

export function PresenterToolbar({ state }: { state: AppState }) {
  const c = state.controls;
  const st = state.stats;
  const dropPct = st && st.totalFrames ? (st.droppedFrames / st.totalFrames) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <Toggle label="Blank" on={c.blank} action="blank" state={state} danger />
        <Toggle label="Freeze" on={c.freeze} action="freeze" state={state} />
        {state.cursorHideSupported === false ? (
          <button
            disabled
            title="Chromium's capture always draws the cursor; hiding it needs the native engine (Phase 2)."
            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs opacity-60 ring-1 ring-slate-700"
          >
            Cursor: can’t hide (Phase 1)
          </button>
        ) : (
          <Toggle
            label={c.cursor ? 'Cursor: shown' : 'Cursor: hidden'}
            on={!c.cursor}
            action="cursor"
            state={state}
          />
        )}
        <Toggle label="Stats" on={c.statsOverlay} action="stats" state={state} />
        <Toggle
          label="Hide Output"
          on={state.outputHiddenByUser}
          action="hide-output"
          state={state}
          danger
        />
      </div>
      {st && (
        <p
          className="font-mono text-[11px] text-slate-400"
          title="Measured on the Output with requestVideoFrameCallback"
        >
          {st.deliveredFps} fps · {dropPct.toFixed(1)}% dropped · latency{' '}
          {fmt(st.medianLatencyMs, 'ms')} · {st.refreshRate} Hz
        </p>
      )}
      {state.cursorHideSupported === false && (
        <p className="text-[11px] text-amber-300">
          Hiding the cursor isn’t possible with Phase 1 capture: Chromium always draws it. The
          native engine (Phase 2) can hide it.
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        Keys in this window: B blank · F freeze · M fill mode · S stats · C cursor · Ctrl+←/→ source
        · Esc hide. From any app: the global hotkeys (hover a button, or see Settings).
      </p>
    </div>
  );
}
