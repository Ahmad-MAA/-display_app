/**
 * Persisted settings (userData/settings.json). Parsing is tolerant: unknown or invalid
 * fields fall back to defaults, so a hand-edited or older file never breaks startup.
 */
import { DEFAULT_HOTKEYS, type PresenterAction } from './controls';
import { FILL_MODES } from './geometry';
import type { EngineKind, FillMode } from './outputEngine';
import type { CaptureSource } from './sources';

export const SETTINGS_VERSION = 1;

/** A source the presenter wants handy. Ids change between runs, so match by process + title. */
export interface Favorite {
  id: string;
  kind: 'window' | 'screen';
  processName: string | null;
  title: string;
  /** Screens: Electron display id. */
  displayId: string | null;
}

export type SourceRef = Omit<Favorite, 'id'>;

export interface Settings {
  version: typeof SETTINGS_VERSION;
  /** Last projector display chosen in the dropdown (null = automatic). */
  preferredDisplayId: number | null;
  fillMode: FillMode;
  followFullscreen: boolean;
  /** Global accelerator per action (Electron syntax). */
  hotkeys: Record<PresenterAction, string>;
  /** 'native' is the Phase 2 engine; not selectable in Phase 1. */
  engine: EngineKind;
  favorites: Favorite[];
  /** What was on the projector last; offered as "Resume" on the next launch. */
  lastProjection: SourceRef | null;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  preferredDisplayId: null,
  fillMode: 'fit',
  followFullscreen: true,
  hotkeys: Object.fromEntries(DEFAULT_HOTKEYS.map((h) => [h.action, h.global])) as Record<
    PresenterAction,
    string
  >,
  engine: 'electron',
  favorites: [],
  lastProjection: null,
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function parseRef(v: unknown): SourceRef | null {
  if (!isObj(v)) return null;
  const kind = v['kind'] === 'screen' ? 'screen' : v['kind'] === 'window' ? 'window' : null;
  const title = str(v['title']);
  if (!kind || title === null) return null;
  return { kind, title, processName: str(v['processName']), displayId: str(v['displayId']) };
}

export function parseSettings(raw: unknown): Settings {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys },
    favorites: [],
  };
  if (!isObj(raw)) return s;
  const pd = raw['preferredDisplayId'];
  if (typeof pd === 'number' && Number.isFinite(pd)) s.preferredDisplayId = pd;
  const fm = raw['fillMode'];
  if (typeof fm === 'string' && (FILL_MODES as readonly string[]).includes(fm)) {
    s.fillMode = fm as FillMode;
  }
  if (typeof raw['followFullscreen'] === 'boolean') s.followFullscreen = raw['followFullscreen'];
  // Phase 1 always runs the Electron engine, whatever the file says.
  s.engine = 'electron';
  const hk = raw['hotkeys'];
  if (isObj(hk)) {
    for (const h of DEFAULT_HOTKEYS) {
      const v = hk[h.action];
      if (typeof v === 'string' && v.trim() !== '') s.hotkeys[h.action] = v;
    }
  }
  const favs = raw['favorites'];
  if (Array.isArray(favs)) {
    for (const f of favs as unknown[]) {
      const ref = parseRef(f);
      const id = isObj(f) ? str(f['id']) : null;
      if (ref && id) s.favorites.push({ id, ...ref });
    }
  }
  s.lastProjection = parseRef(raw['lastProjection']);
  return s;
}

export function refOf(src: CaptureSource): SourceRef {
  const d = src.descriptor;
  return { kind: d.kind, processName: d.processName, title: d.title, displayId: d.displayId };
}

const norm = (t: string) => t.trim().toLowerCase();

/**
 * Find the open source that best matches a saved reference.
 * Windows: same process (when known) required; exact title beats a title that contains the
 * other (e.g. "Deck.pptx - PowerPoint" vs "Deck.pptx - PowerPoint [Read-Only]"), which beats
 * "the only window of that app". Screens: same display id.
 */
export function matchSource(
  sources: readonly CaptureSource[],
  ref: SourceRef,
): CaptureSource | null {
  if (ref.kind === 'screen') {
    return (
      sources.find(
        (s) => s.descriptor.kind === 'screen' && s.descriptor.displayId === ref.displayId,
      ) ?? null
    );
  }
  const sameApp = sources.filter(
    (s) =>
      s.descriptor.kind === 'window' &&
      (ref.processName === null ||
        s.descriptor.processName === null ||
        norm(s.descriptor.processName) === norm(ref.processName)),
  );
  const t = norm(ref.title);
  const exact = sameApp.find((s) => norm(s.descriptor.title) === t);
  if (exact) return exact;
  if (t.length >= 3) {
    const partial = sameApp.find((s) => {
      const st = norm(s.descriptor.title);
      return st.length >= 3 && (st.includes(t) || t.includes(st));
    });
    if (partial) return partial;
  }
  if (ref.processName !== null) {
    const byApp = sameApp.filter((s) => s.descriptor.processName !== null);
    if (byApp.length === 1) return byApp[0] ?? null;
  }
  return null;
}

export function sameRef(a: SourceRef, b: SourceRef): boolean {
  return (
    a.kind === b.kind &&
    norm(a.title) === norm(b.title) &&
    (a.processName ?? '').toLowerCase() === (b.processName ?? '').toLowerCase() &&
    a.displayId === b.displayId
  );
}
