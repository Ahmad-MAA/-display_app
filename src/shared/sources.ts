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
  data: Uint8Array,
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
