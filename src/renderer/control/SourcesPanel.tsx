import { useEffect, useMemo, useState } from 'react';
import type { ContentProtectionStatus } from '@shared/diagnostics';
import type { ProjectionInfo } from '@shared/projection';
import { matchSource, refOf, sameRef, type Favorite } from '@shared/settings';
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

const ACTIVE_LABEL: Partial<Record<ProjectionInfo['state'], string>> = {
  restoring: 'Restoring…',
  starting: 'Starting…',
  live: 'On projector',
  ended: 'Closed',
  error: 'Failed',
};

function SourceCard({
  source,
  protectionOk,
  projection,
  onPick,
}: {
  source: CaptureSource;
  protectionOk: boolean;
  projection: ProjectionInfo;
  onPick: (sourceId: string) => void;
}) {
  const d = source.descriptor;
  const disabled = source.isProjectorScreen && !protectionOk;
  const active = projection.source?.sourceId === d.sourceId ? projection.state : null;
  const activeLabel = active ? ACTIVE_LABEL[active] : undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onPick(d.sourceId);
      }}
      className={`block w-full overflow-hidden rounded-lg border bg-slate-900 text-left transition hover:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:border-slate-800 ${
        active === 'live'
          ? 'border-sky-500 ring-2 ring-sky-500'
          : source.isProjectorScreen
            ? 'border-amber-600/70'
            : 'border-slate-800'
      } ${disabled ? 'opacity-50' : ''} ${source.minimized ? 'border-dashed' : ''}`}
      title={
        disabled
          ? 'Disabled: capture exclusion unavailable'
          : source.minimized
            ? `${d.title} (minimized; picking it restores it without taking focus)`
            : `Project “${d.title}”`
      }
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
              <span>Click to restore it and project it; the Control Panel keeps focus.</span>
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
        {activeLabel && (
          <span
            className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              active === 'live'
                ? 'bg-sky-500 text-white'
                : active === 'error' || active === 'ended'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-600 text-white'
            }`}
          >
            {activeLabel}
          </span>
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
    </button>
  );
}

function FavoritesBar({
  favorites,
  list,
  onNotice,
}: {
  favorites: readonly Favorite[];
  list: SourceList | null;
  onNotice: (text: string) => void;
}) {
  if (favorites.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">Favorites:</span>
      {favorites.map((f) => {
        const open = list ? matchSource(list.sources, f) : null;
        return (
          <span
            key={f.id}
            className={`flex items-center rounded-full text-xs ring-1 ${
              open ? 'bg-slate-800 ring-amber-600/60' : 'bg-slate-900 text-slate-500 ring-slate-800'
            }`}
          >
            <button
              className="max-w-56 truncate py-1 pr-1 pl-2.5 hover:text-white disabled:cursor-default"
              disabled={!open}
              title={open ? `Project “${open.descriptor.title}”` : `“${f.title}” isn’t open`}
              onClick={() => {
                void api.projectFavorite(f.id).then((r) => {
                  if (!r.ok && r.message) onNotice(r.message);
                });
              }}
            >
              ★ {f.title}
            </button>
            <button
              className="px-2 py-1 text-slate-500 hover:text-rose-300"
              title="Remove favorite"
              onClick={() => void api.removeFavorite(f.id)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function SourcesPanel({
  list,
  protection,
  projection,
  onPick,
  favorites,
  onNotice,
}: {
  list: SourceList | null;
  protection: ContentProtectionStatus | null;
  projection: ProjectionInfo;
  onPick: (sourceId: string) => void;
  favorites: readonly Favorite[];
  onNotice: (text: string) => void;
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
      <FavoritesBar favorites={favorites} list={list} onNotice={onNotice} />
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
          <div key={s.descriptor.sourceId} className="relative">
            <SourceCard
              source={s}
              protectionOk={protectionOk}
              projection={projection}
              onPick={onPick}
            />
            {(() => {
              const fav = favorites.some((f) => sameRef(f, refOf(s)));
              return (
                <button
                  className={`absolute right-2 bottom-2 rounded px-1.5 text-base leading-6 ${
                    fav ? 'text-amber-400' : 'text-slate-600 hover:text-amber-300'
                  }`}
                  title={fav ? 'Remove from favorites' : 'Add to favorites'}
                  aria-pressed={fav}
                  onClick={() => void api.toggleFavorite(s.descriptor.sourceId)}
                >
                  {fav ? '★' : '☆'}
                </button>
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}
