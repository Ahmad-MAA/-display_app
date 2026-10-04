import { useState } from 'react';
import {
  acceleratorFromEvent,
  DEFAULT_HOTKEYS,
  prettyAccelerator,
  type PresenterAction,
} from '@shared/controls';
import type { AppState } from '@shared/diagnostics';

const api = window.projectorDesk;

/** Click "Change", then press the new combination (Esc cancels). */
function HotkeyRow({
  action,
  label,
  accelerator,
  registered,
  onSet,
}: {
  action: PresenterAction;
  label: string;
  accelerator: string;
  registered: boolean | undefined;
  onSet: (a: PresenterAction, acc: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <tr className="border-t border-slate-800">
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 pr-3 font-mono">
        {recording ? (
          <>
            <input
              autoFocus
              readOnly
              className="w-56 rounded bg-slate-800 px-2 py-0.5 text-amber-200 ring-1 ring-amber-600 outline-none"
              value="Press keys…"
              onBlur={() => {
                setRecording(false);
                setHint(null);
              }}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Escape') {
                  setRecording(false);
                  setHint(null);
                  return;
                }
                const r = acceleratorFromEvent(e);
                if (!r) return;
                if ('error' in r) {
                  setHint(r.error);
                  return;
                }
                setRecording(false);
                setHint(null);
                onSet(action, r.accelerator);
              }}
            />
            {hint && (
              <p className="mt-1 font-sans text-xs whitespace-normal text-amber-300">{hint}</p>
            )}
          </>
        ) : (
          <span className={registered === false ? 'text-rose-300' : ''}>
            {prettyAccelerator(accelerator)}
            {registered === false && ' (unavailable: taken by another app or invalid)'}
          </span>
        )}
      </td>
      <td className="py-1.5">
        <button
          className="rounded bg-slate-800 px-2 py-0.5 text-xs ring-1 ring-slate-700 hover:bg-slate-700"
          onClick={() => {
            setRecording(true);
          }}
        >
          Change
        </button>
      </td>
    </tr>
  );
}

export function SettingsPanel({ state }: { state: AppState }) {
  const s = state.settings;
  const set = (a: PresenterAction, acc: string) => {
    void api.setHotkeys({ ...s.hotkeys, [a]: acc });
  };
  const resetAll = () => {
    void api.setHotkeys(
      Object.fromEntries(DEFAULT_HOTKEYS.map((h) => [h.action, h.global])) as Record<
        PresenterAction,
        string
      >,
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">
            Global hotkeys
          </h2>
          <button
            className="rounded bg-slate-800 px-2 py-0.5 text-xs ring-1 ring-slate-700 hover:bg-slate-700"
            onClick={resetAll}
          >
            Reset to defaults
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Work from any app without taking focus. Each needs Ctrl, Alt or Win so it can’t steal
          normal typing. Avoid Ctrl+Alt+arrows (many Intel drivers rotate the screen).
        </p>
        <table className="w-full text-left text-sm">
          <tbody>
            {DEFAULT_HOTKEYS.map((h) => (
              <HotkeyRow
                key={h.action}
                action={h.action}
                label={h.label}
                accelerator={s.hotkeys[h.action]}
                registered={state.hotkeys.find((x) => x.action === h.action)?.registered}
                onSet={set}
              />
            ))}
          </tbody>
        </table>
      </section>
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
        <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Output engine
        </h2>
        <label className="flex items-center gap-2">
          <input type="radio" checked readOnly className="accent-sky-500" /> Electron (Phase 1)
        </label>
        <label className="flex items-center gap-2 text-slate-500">
          <input type="radio" disabled className="accent-sky-500" /> Native:
          Windows.Graphics.Capture + Direct3D (Phase 2; not available yet)
        </label>
        <p className="text-xs text-slate-500">
          The native engine brings sub-frame latency, HDR passthrough and cursor hiding. Sessions
          measured over budget are saved in logs/sessions.jsonl as the case for it.
        </p>
        <h2 className="pt-2 text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Remembered
        </h2>
        <ul className="list-disc pl-5 text-xs text-slate-400">
          <li>
            Projector display:{' '}
            {s.preferredDisplayId === null ? 'automatic' : `display ${s.preferredDisplayId}`}
          </li>
          <li>Fill mode: {s.fillMode}</li>
          <li>Follow full screen: {s.followFullscreen ? 'on' : 'off'}</li>
          <li>Favorites: {s.favorites.length}</li>
          <li>
            Last projection:{' '}
            {s.lastProjection
              ? `${s.lastProjection.title} (${s.lastProjection.processName ?? s.lastProjection.kind})`
              : 'none'}
          </li>
        </ul>
        <p className="text-xs text-slate-500">
          Saved automatically to settings.json in the app’s data folder.
        </p>
      </section>
    </div>
  );
}
