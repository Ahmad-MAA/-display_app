import { useEffect, useRef } from 'react';
import type { ProjectionInfo } from '@shared/projection';

const api = window.projectorDesk;

/**
 * Low-res (≤480×270, 10 fps) second capture of the projected source, so the presenter
 * sees what the audience sees without looking at the projector. main's display-media
 * handler hands the Control Panel the same source as the Output window.
 */
function Preview({ projection }: { projection: ProjectionInfo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const active = projection.source !== null && projection.state === 'live';
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getDisplayMedia({
        video: { frameRate: { max: 10 }, width: { max: 480 }, height: { max: 270 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        stream = s;
        el.srcObject = s;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (stream) for (const t of stream.getTracks()) t.stop();
      el.srcObject = null;
    };
  }, [active, projection.token]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-black ring-1 ring-slate-800">
      <video ref={ref} autoPlay muted playsInline className="h-full w-full object-contain" />
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

export function NowProjecting({
  projection,
  notice,
}: {
  projection: ProjectionInfo;
  notice: { tone: 'warn' | 'bad'; text: string } | null;
}) {
  const p = projection;
  const tone =
    p.state === 'live' && !p.blank
      ? 'text-emerald-300'
      : p.state === 'error' || p.state === 'ended'
        ? 'text-rose-300'
        : 'text-amber-300';
  return (
    <div className="space-y-2 text-sm">
      <Preview projection={p} />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
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
