import { desktopCapturer, type DesktopCapturerSource, type NativeImage } from 'electron';
import { parseSourceId } from '@shared/outputEngine';
import {
  isBlankBitmap,
  mergeMinimized,
  toDescriptor,
  type CaptureSource,
  type SourceList,
  type SourceMemo,
} from '@shared/sources';
import { log } from './log';
import { WindowHelper } from './windowHelper';

export const THUMBNAIL_SIZE = { width: 320, height: 180 } as const;
const REFRESH_MS = 2000;

export interface SourceContext {
  /** HWNDs of ProjectorDesk's own windows; never offered as sources. */
  ownHwnds(): Set<string>;
  /** Display the Output window is on (to flag its screen). */
  projectorDisplayId(): number | null;
  displayLabel(displayId: string): string | null;
}

function hwndOf(win: { getMediaSourceId(): string }): string | null {
  const parsed = parseSourceId(win.getMediaSourceId());
  return parsed?.kind === 'window' ? parsed.hwnd : null;
}

export function ownHwnds(windows: readonly { getMediaSourceId(): string }[]): Set<string> {
  const set = new Set<string>();
  for (const w of windows) {
    const h = hwndOf(w);
    if (h) set.add(h);
  }
  return set;
}

/**
 * Enumerates windows and screens via desktopCapturer. Polls every 2 s only while the
 * Control Panel is focused (getSources with thumbnails is not free), plus on demand.
 */
export class SourceService {
  private readonly helper = new WindowHelper();
  /** Last good thumbnail/icon per HWND, shown while that window is minimized. */
  private readonly memo = new Map<string, SourceMemo>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<SourceList> | null = null;
  private last: SourceList = { at: new Date(0).toISOString(), sources: [], error: null };
  private lastErrorLogged: string | null = null;

  constructor(
    private readonly ctx: SourceContext,
    private readonly onList: (list: SourceList) => void,
  ) {}

  get latest(): SourceList {
    return this.last;
  }

  startPolling(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Coalesces concurrent calls: a slow enumeration is never started twice. */
  refresh(): Promise<SourceList> {
    this.inFlight ??= this.enumerate().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async enumerate(): Promise<SourceList> {
    let raw: DesktopCapturerSource[];
    // Minimized windows are fetched in parallel: getSources() omits them on Windows.
    const minimizedP = this.helper.minimized();
    try {
      raw = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true,
      });
    } catch (err) {
      await minimizedP;
      const message = `Could not list windows and screens: ${String(err)}. If Windows privacy settings block screen capture for desktop apps, allow it and press Refresh.`;
      if (this.lastErrorLogged !== message) log('error', message);
      this.lastErrorLogged = message;
      this.last = { at: new Date().toISOString(), sources: this.last.sources, error: message };
      this.onList(this.last);
      return this.last;
    }
    this.lastErrorLogged = null;

    const own = this.ctx.ownHwnds();
    const projectorId = this.ctx.projectorDisplayId();
    const windowHwnds = raw
      .map((s) => parseSourceId(s.id))
      .flatMap((p) => (p?.kind === 'window' && !own.has(p.hwnd) ? [p.hwnd] : []));
    const names = await this.helper.processNames(windowHwnds);

    const sources: CaptureSource[] = [];
    for (const s of raw) {
      const parsed = parseSourceId(s.id);
      if (!parsed) continue;
      if (parsed.kind === 'window' && own.has(parsed.hwnd)) continue;
      // Typed as non-null, but Electron documents appIcon as null when unavailable.
      const appIcon = s.appIcon as NativeImage | null;
      const descriptor = toDescriptor(
        s,
        parsed.kind === 'window' ? (names.get(parsed.hwnd) ?? null) : null,
      );
      if (!descriptor) continue;
      const size = s.thumbnail.getSize();
      const empty = s.thumbnail.isEmpty();
      const blank =
        empty || isBlankBitmap(new Uint8Array(s.thumbnail.toBitmap()), size.width, size.height);
      sources.push({
        descriptor,
        thumbnail: empty
          ? null
          : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`,
        icon: appIcon && !appIcon.isEmpty() ? appIcon.toDataURL() : null,
        thumbnailBlank: blank,
        minimized: false,
        isProjectorScreen:
          descriptor.kind === 'screen' &&
          projectorId !== null &&
          descriptor.displayId === String(projectorId),
        displayLabel: descriptor.displayId ? this.ctx.displayLabel(descriptor.displayId) : null,
      });
    }
    const minimized = await minimizedP;
    const merged = mergeMinimized(sources, minimized, (h) => this.memo.get(h), own);
    this.updateMemo(merged);
    this.last = { at: new Date().toISOString(), sources: merged, error: null };
    this.onList(this.last);
    return this.last;
  }

  /** Remember visible windows' thumbnails; forget windows that no longer exist. */
  private updateMemo(sources: readonly CaptureSource[]): void {
    const present = new Set<string>();
    for (const s of sources) {
      const h = s.descriptor.hwnd;
      if (!h) continue;
      present.add(h);
      if (!s.minimized && !s.thumbnailBlank) {
        this.memo.set(h, { thumbnail: s.thumbnail, icon: s.icon });
      }
    }
    for (const h of this.memo.keys()) if (!present.has(h)) this.memo.delete(h);
  }

  dispose(): void {
    this.stopPolling();
    this.helper.dispose();
  }
}
