import { useEffect, useMemo, useState } from 'react';
import type { ContentProtectionStatus } from '@shared/diagnostics';
import { filterSources, type CaptureSource, type SourceList } from '@shared/sources';

const api = window.projectorDesk;

export function useSources(): SourceList | null {
  const [list, setList] = useState<SourceList | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSources().then((l) => {
      if (alive) setList(l);
    });
    const off = api.onSources(setList);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

function SourceCard({ source, protectionOk }: { source: CaptureSource; protectionOk: boolean }) {
  const d = source.descriptor;
  const disabled = source.isProjectorScreen && !protectionOk;
  return (
    <article
      className={`overflow-hidden rounded-lg border bg-slate-900 ${
        source.isProjectorScreen ? 'border-amber-600/70' : 'border-slate-800'
      } ${disabled ? 'opacity-50' : ''} ${source.minimized ? 'border-dashed' : ''}`}
      title={source.minimized ? `${d.title} (minimized)` : d.title}
    >
      <div className="relative aspect-video bg-black">
        {source.thumbnail && !source.thumbnailBlank && (
          <img
            src={source.thumbnail}
            alt=""
            className={`h-full w-full object-contain ${source.minimized ? 'opacity-35 grayscale' : ''}`}
          />
        )}
        {source.minimized ? (
          <div className="absolute inset-0 flex items-center justify-center p-3">
            <div className="flex max-w-[90%] flex-col items-center gap-1 rounded-md bg-black/75 px-3 py-2 text-center text-xs text-slate-200">
              <span className="rounded bg-slate-600 px-1.5 py-0.5 font-semibold">Minimized</span>
              <span>
                Restore this window to project it. Windows can’t capture minimized windows.
              </span>
            </div>
          </div>
        ) : (
          source.thumbnailBlank && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center text-xs text-amber-200">
              <span className="font-semibold">Nothing to show</span>
              <span className="text-amber-200/80">
                {d.kind === 'window'
                  ? 'This window returned a black image: protected (DRM) video, or a window that isn’t drawing.'
                  : 'This screen returned a black image.'}
              </span>
            </div>
          )
        )}
        {source.isProjectorScreen && (
          <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-[11px] font-semibold text-black">
            Output is on this screen
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {source.icon ? (
          <img
            src={source.icon}
            alt=""
            className={`h-4 w-4 shrink-0 ${source.minimized ? 'opacity-50 grayscale' : ''}`}
          />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${source.minimized ? 'text-slate-400' : ''}`}>
            {d.title || '(untitled)'}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {d.kind === 'window'
              ? (d.processName ?? 'unknown process')
              : (source.displayLabel ?? `display ${d.displayId ?? '?'}`)}
          </p>
        </div>
      </div>
      {source.isProjectorScreen && (
        <p className="border-t border-slate-800 px-2.5 py-1.5 text-[11px] text-amber-200/90">
          {protectionOk
            ? 'Capturing this screen is safe (Output is excluded from capture), but it shows whatever else is on the projector.'
            : 'Disabled: capture exclusion is unavailable, so this would mirror the Output into itself.'}
        </p>
      )}
    </article>
  );
}

export function SourcesPanel({
  list,
  protection,
}: {
  list: SourceList | null;
  protection: ContentProtectionStatus | null;
}) {
  const now = useNow(1000);
  const [tab, setTab] = useState<'window' | 'screen'>('window');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(
    () => (list ? filterSources(list.sources, tab, query) : []),
    [list, tab, query],
  );
  const counts = useMemo(
    () => ({
      window: list?.sources.filter((s) => s.descriptor.kind === 'window').length ?? 0,
      screen: list?.sources.filter((s) => s.descriptor.kind === 'screen').length ?? 0,
    }),
    [list],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshSources();
    } finally {
      setRefreshing(false);
    }
  };

  const age = list ? Math.max(0, Math.round((now - Date.parse(list.at)) / 1000)) : null;
  const protectionOk = protection?.ok ?? false;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex rounded-md bg-slate-900 p-0.5 ring-1 ring-slate-800">
          {(['window', 'screen'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
              }}
              className={`rounded px-3 py-1 text-sm ${
                tab === k ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {k === 'window' ? 'Windows' : 'Screens'}{' '}
              <span className="text-xs text-slate-500">{counts[k]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Filter by title or app…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="min-w-48 flex-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm ring-1 ring-slate-800 placeholder:text-slate-500 focus:ring-sky-600 focus:outline-none"
        />
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="text-xs text-slate-500">
          {age === null
            ? 'Loading…'
            : `Updated ${age}s ago · auto-refreshes every 2 s while this window is focused`}
        </span>
      </div>

      {list?.error && (
        <div
          role="alert"
          className="rounded-md border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200"
        >
          {list.error}
        </div>
      )}

      {list && shown.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
          {query
            ? `Nothing matches “${query}”.`
            : tab === 'window'
              ? 'No capturable windows found.'
              : 'No screens found.'}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {shown.map((s) => (
          <SourceCard key={s.descriptor.sourceId} source={s} protectionOk={protectionOk} />
        ))}
      </div>
    </section>
  );
}
