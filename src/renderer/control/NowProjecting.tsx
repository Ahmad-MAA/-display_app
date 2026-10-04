import { useState } from 'react';
import type { OutputDisplay } from '@shared/geometry';
import type { FillMode } from '@shared/outputEngine';
import type { ProjectionInfo } from '@shared/projection';
import { CropEditor, CropOutline, useContentBox, useProjectedStream } from './CropEditor';

const api = window.projectorDesk;

/**
 * Low-res (≤480×270, 10 fps) second capture of the projected source, so the presenter
 * sees what's on the projector without looking at it. Shows the full source frame with
 * the active crop outlined.
 */
function Preview({ projection, display }: { projection: ProjectionInfo; display: OutputDisplay }) {
  const active = projection.source !== null && projection.state === 'live';
  const ref = useProjectedStream(active, projection.token, 480, 270);
  const box = useContentBox(ref);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-black ring-1 ring-slate-800">
      <video ref={ref} autoPlay muted playsInline className="h-full w-full object-contain" />
      {active && box && display.crop && <CropOutline box={box} crop={display.crop} />}
      {!active && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          {projection.state === 'restoring'
            ? 'Restoring window…'
            : projection.state === 'starting'
              ? 'Starting capture…'
              : 'Projector is black'}
        </div>
      )}
    </div>
  );
}

const STATE_LABEL: Record<ProjectionInfo['state'], string> = {
  idle: 'Nothing projected',
  restoring: 'Restoring',
  starting: 'Starting',
  live: 'On projector',
  ended: 'Source closed',
  error: 'Failed',
};

const FILL_LABEL: Record<FillMode, { label: string; hint: string }> = {
  fit: { label: 'Fit', hint: 'Whole picture, black bars if the shape differs' },
  fill: { label: 'Fill', hint: 'Fill the screen, trimming edges' },
  stretch: { label: 'Stretch', hint: 'Fill the screen, distorting the shape' },
};

function DisplayControls({
  display,
  canCrop,
  onCrop,
}: {
  display: OutputDisplay;
  canCrop: boolean;
  onCrop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Fill mode"
        className="flex rounded-md bg-slate-900 p-0.5 ring-1 ring-slate-800"
      >
        {(['fit', 'fill', 'stretch'] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={display.fillMode === m}
            title={FILL_LABEL[m].hint}
            onClick={() => void api.setFillMode(m)}
            className={`rounded px-2.5 py-1 text-xs ${
              display.fillMode === m
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {FILL_LABEL[m].label}
          </button>
        ))}
      </div>
      <button
        onClick={onCrop}
        disabled={!canCrop}
        className={`rounded-md px-2.5 py-1 text-xs ring-1 disabled:opacity-40 ${
          display.crop
            ? 'bg-sky-600 text-white ring-sky-500 hover:bg-sky-500'
            : 'bg-slate-800 ring-slate-700 hover:bg-slate-700'
        }`}
      >
        {display.crop ? 'Crop: on' : 'Crop…'}
      </button>
      {display.crop && (
        <button
          onClick={() => void api.setCrop(null)}
          className="rounded-md bg-slate-800 px-2.5 py-1 text-xs ring-1 ring-slate-700 hover:bg-slate-700"
        >
          Clear crop
        </button>
      )}
    </div>
  );
}

export function NowProjecting({
  projection,
  notice,
  followFullscreen,
  display,
}: {
  projection: ProjectionInfo;
  notice: { tone: 'warn' | 'bad'; text: string } | null;
  followFullscreen: boolean;
  display: OutputDisplay;
}) {
  const p = projection;
  const [cropping, setCropping] = useState(false);
  const tone =
    p.state === 'live' && !p.blank
      ? 'text-emerald-300'
      : p.state === 'error' || p.state === 'ended'
        ? 'text-rose-300'
        : 'text-amber-300';
  return (
    <div className="space-y-2 text-sm">
      <Preview projection={p} display={display} />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold tracking-wide uppercase ${tone}`}>
            {STATE_LABEL[p.state]}
            {p.state === 'live' && p.width && p.height ? ` · ${p.width}×${p.height}` : ''}
          </p>
          <p className="truncate" title={p.source?.title}>
            {p.source?.title ?? '—'}
          </p>
        </div>
        <button
          onClick={() => void api.project(null)}
          disabled={p.state === 'idle'}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-40"
        >
          Stop
        </button>
      </div>
      <DisplayControls
        display={display}
        canCrop={p.state === 'live'}
        onCrop={() => {
          setCropping(true);
        }}
      />
      {cropping && (
        <CropEditor
          token={p.token}
          crop={display.crop}
          onClose={() => {
            setCropping(false);
          }}
        />
      )}
      {p.following && (
        <p className="rounded-md bg-sky-950/60 p-2 text-xs text-sky-200 ring-1 ring-sky-800">
          <span className="font-semibold">Following full screen. </span>
          {p.following.mode === 'window'
            ? `Capturing the app’s full-screen window “${p.following.title}”; switches back when it leaves full screen.`
            : `The full-screen window can’t be captured on its own, so ${p.following.screenLabel ?? 'its screen'} is captured instead (everything on that screen is shown).`}
        </p>
      )}
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          className="mt-0.5 accent-sky-500"
          checked={followFullscreen}
          onChange={(e) => void api.setFollowFullscreen(e.target.checked)}
        />
        <span>
          Follow full screen
          <span className="block text-slate-500">
            When the projected app opens a separate full-screen window (Windows Media Player, VLC,
            PowerPoint slide show), project that instead.
          </span>
        </span>
      </label>
      {p.message && (
        <p
          role="alert"
          className={`rounded-md p-2 text-xs ${
            p.state === 'live'
              ? 'bg-amber-950/60 text-amber-200 ring-1 ring-amber-800'
              : 'bg-rose-950/60 text-rose-200 ring-1 ring-rose-800'
          }`}
        >
          {p.message}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className={`rounded-md p-2 text-xs ring-1 ${
            notice.tone === 'bad'
              ? 'bg-rose-950/60 text-rose-200 ring-rose-800'
              : 'bg-amber-950/60 text-amber-200 ring-amber-800'
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
