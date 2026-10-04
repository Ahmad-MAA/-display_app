/**
 * Capture-source model shared by main and the Control Panel. Pure: no Electron imports.
 */
import { parseSourceId, type SourceDescriptor } from './outputEngine';

export interface CaptureSource {
  descriptor: SourceDescriptor;
  /** JPEG data URL of the 320×180 thumbnail, or null if Windows returned none. */
  thumbnail: string | null;
  /** PNG data URL of the window's icon (windows only). */
  icon: string | null;
  /**
   * Thumbnail is empty or (nearly) all black. Usually a minimized window, which
   * Windows cannot capture; occasionally DRM-protected content.
   */
  thumbnailBlank: boolean;
  /**
   * Window is minimized. Windows can't capture minimized windows and Electron omits them
   * from getSources(), so these come from the window helper and show the last-seen
   * thumbnail (if any), greyed out, with a "restore this window" hint.
   */
  minimized: boolean;
  /** Screen sources only: this screen hosts the Output window. */
  isProjectorScreen: boolean;
  /** Screen sources only: label of the matching display. */
  displayLabel: string | null;
}

export interface SourceList {
  at: string;
  sources: CaptureSource[];
  /** Set when enumeration failed (e.g. capture permission denied). */
  error: string | null;
}

/** Minimal shape of Electron's DesktopCapturerSource that we need. */
export interface RawSource {
  id: string;
  name: string;
  display_id: string;
}

export function toDescriptor(raw: RawSource, processName: string | null): SourceDescriptor | null {
  const parsed = parseSourceId(raw.id);
  if (!parsed) return null;
  if (parsed.kind === 'window') {
    return {
      sourceId: raw.id,
      kind: 'window',
      hwnd: parsed.hwnd,
      displayId: null,
      processName,
      title: raw.name,
    };
  }
  return {
    sourceId: raw.id,
    kind: 'screen',
    hwnd: null,
    displayId: raw.display_id || null,
    processName: null,
    title: raw.name,
  };
}

/**
 * True when a BGRA/RGBA bitmap is empty or effectively black. Samples a grid of
 * pixels instead of every pixel; thumbnails are 320×180 so this stays cheap.
 */
export function isBlankBitmap(
  data: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 12,
): boolean {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return true;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 24));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (
        (data[i] ?? 0) > threshold ||
        (data[i + 1] ?? 0) > threshold ||
        (data[i + 2] ?? 0) > threshold
      ) {
        return false;
      }
    }
  }
  return true;
}

export function filterSources(
  sources: readonly CaptureSource[],
  kind: 'window' | 'screen',
  query: string,
): CaptureSource[] {
  const q = query.trim().toLowerCase();
  return sources.filter(
    (s) =>
      s.descriptor.kind === kind &&
      (!q ||
        s.descriptor.title.toLowerCase().includes(q) ||
        (s.descriptor.processName?.toLowerCase().includes(q) ?? false)),
  );
}

/** A minimized top-level window reported by the native window helper. */
export interface MinimizedWindow {
  hwnd: string;
  title: string;
  processName: string | null;
}

/** Last good thumbnail/icon seen for a window while it was visible. */
export interface SourceMemo {
  thumbnail: string | null;
  icon: string | null;
}

/**
 * Merge minimized windows into the capturer's list so they stay visible (and pickable)
 * instead of vanishing. Listed windows that are actually minimized get flagged; unlisted
 * minimized windows are appended (after the live ones) using their last-seen thumbnail.
 */
export function mergeMinimized(
  listed: readonly CaptureSource[],
  minimized: readonly MinimizedWindow[],
  memo: (hwnd: string) => SourceMemo | undefined,
  own: ReadonlySet<string>,
): CaptureSource[] {
  const min = new Map(minimized.filter((w) => !own.has(w.hwnd)).map((w) => [w.hwnd, w]));
  const seen = new Set<string>();
  const out: CaptureSource[] = listed.map((s) => {
    const hwnd = s.descriptor.hwnd;
    if (!hwnd || !min.has(hwnd)) return s;
    seen.add(hwnd);
    const m = memo(hwnd);
    const thumbnail = s.thumbnailBlank ? (m?.thumbnail ?? null) : s.thumbnail;
    return { ...s, minimized: true, thumbnail, thumbnailBlank: thumbnail === null };
  });
  for (const w of min.values()) {
    if (seen.has(w.hwnd)) continue;
    const m = memo(w.hwnd);
    const thumbnail = m?.thumbnail ?? null;
    out.push({
      descriptor: {
        // Same id format Electron uses for windows, so it matches once restored.
        sourceId: `window:${w.hwnd}:0`,
        kind: 'window',
        hwnd: w.hwnd,
        displayId: null,
        processName: w.processName,
        title: w.title,
      },
      thumbnail,
      icon: m?.icon ?? null,
      thumbnailBlank: thumbnail === null,
      minimized: true,
      isProjectorScreen: false,
      displayLabel: null,
    });
  }
  return out;
}
