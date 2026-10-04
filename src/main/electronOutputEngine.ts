import { session, webContents, type WebContents } from 'electron';
import {
  DEFAULT_DISPLAY,
  normalizeCrop,
  type CropRect,
  type OutputDisplay,
} from '@shared/geometry';
import type { FillMode, SourceDescriptor } from '@shared/outputEngine';
import {
  describeCaptureError,
  IDLE_PROJECTION,
  type FollowInfo,
  type ProjectionInfo,
  type SourceStatus,
} from '@shared/projection';
import { log } from './log';
import type { OutputWindow } from './outputWindow';

export type FollowProblem = 'error' | 'blank' | 'ended';

/**
 * Phase 1 output engine: the Output BrowserWindow captures the chosen source itself
 * (getDisplayMedia), so frames never cross IPC. Main only decides WHICH source a
 * capture request receives, via setDisplayMediaRequestHandler.
 *
 * Two descriptors are tracked:
 * - `projection.source`: what the presenter picked (shown in the UI);
 * - `effective`: what is actually captured. They differ while "Follow full screen"
 *   redirects capture to the picked app's separate full-screen window (or its screen).
 *
 * Build step 4 covers setSource / source-ended / errors; fill modes, crop, blank,
 * freeze, cursor and stats complete the OutputEngine contract in steps 5–7.
 */
export class ElectronOutputEngine {
  private projection: ProjectionInfo = IDLE_PROJECTION;
  private effective: SourceDescriptor | null = null;
  private token = 0;
  private display: OutputDisplay = DEFAULT_DISPLAY;
  /** Set by the full-screen follower: told when a followed capture fails. */
  onFollowProblem: ((p: FollowProblem) => void) | null = null;

  constructor(
    private readonly output: OutputWindow,
    private readonly controlWc: () => WebContents | null,
    private readonly onChange: (p: ProjectionInfo) => void,
  ) {
    this.installCaptureHandlers();
  }

  get current(): ProjectionInfo {
    return this.projection;
  }

  get currentDisplay(): OutputDisplay {
    return this.display;
  }

  private applyDisplay(d: OutputDisplay): void {
    this.display = d;
    this.output.send('output:display', d);
    this.onChange(this.projection);
  }

  setFillMode(mode: FillMode): void {
    if (mode === this.display.fillMode) return;
    log('info', `Fill mode: ${mode}`);
    this.applyDisplay({ ...this.display, fillMode: mode });
  }

  /** Normalized crop (0..1 of the source frame); null = whole frame. */
  setCrop(crop: CropRect | null): void {
    const c = normalizeCrop(crop);
    log(
      'info',
      c
        ? `Crop: ${(c.width * 100).toFixed(0)}%×${(c.height * 100).toFixed(0)}% at (${(c.x * 100).toFixed(0)}%, ${(c.y * 100).toFixed(0)}%)`
        : 'Crop cleared',
    );
    this.applyDisplay({ ...this.display, crop: c });
  }

  private set(p: ProjectionInfo): void {
    this.projection = p;
    this.onChange(p);
  }

  private isOurs(wc: WebContents | null | undefined): boolean {
    if (!wc) return false;
    return wc === this.output.win.webContents || wc === this.controlWc();
  }

  private installCaptureHandlers(): void {
    const ses = session.defaultSession;
    // Every getDisplayMedia() from the Output window (full-rate) or the Control Panel
    // (low-res "On Projector" preview) receives the source CURRENTLY being captured.
    // Anyone else: denied.
    ses.setDisplayMediaRequestHandler(
      (request, callback) => {
        const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
        const src = this.effective;
        if (!this.isOurs(wc) || !src || !request.videoRequested) {
          log(
            'warn',
            `Display capture request denied (${src ? 'unknown requester' : 'no source selected'})`,
          );
          callback({});
          return;
        }
        callback({ video: { id: src.sourceId, name: src.title } });
      },
      { useSystemPicker: false },
    );
    // Deny-by-default permissions for our own pages; nothing else is ever loaded.
    const allowed = new Set([
      'display-capture',
      'media',
      'clipboard-sanitized-write',
      'fullscreen',
    ]);
    ses.setPermissionRequestHandler((wc, permission, cb) => {
      cb(this.isOurs(wc) && allowed.has(permission));
    });
    ses.setPermissionCheckHandler((wc, permission) => this.isOurs(wc) && allowed.has(permission));
  }

  private startCapture(source: SourceDescriptor | null): void {
    this.effective = source;
    this.token++;
    this.output.send('output:set-source', { token: this.token, source });
  }

  /** A minimized window is being restored before capture starts. */
  markRestoring(source: SourceDescriptor): void {
    this.set({ ...IDLE_PROJECTION, source, state: 'restoring', token: this.token });
  }

  /** Projection failed before capture could start (e.g. the window couldn't be restored). */
  fail(source: SourceDescriptor, message: string): void {
    log('error', `Projection of "${source.title}" failed: ${message}`);
    this.set({ ...IDLE_PROJECTION, source, state: 'error', message, token: this.token });
  }

  setSource(source: SourceDescriptor | null): void {
    log(
      'info',
      source
        ? `Projecting ${source.kind} "${source.title}" (${source.sourceId})`
        : 'Projection stopped',
    );
    this.startCapture(source);
    // A crop belongs to one source; the fill mode carries over.
    if (this.display.crop) this.applyDisplay({ ...this.display, crop: null });
    this.set({
      ...IDLE_PROJECTION,
      source,
      state: source ? 'starting' : 'idle',
      token: this.token,
    });
  }

  /** Capture `target` instead of the picked window (keeps the picked source in the UI). */
  followTo(target: SourceDescriptor, info: FollowInfo): void {
    if (!this.projection.source) return;
    log(
      'info',
      info.mode === 'window'
        ? `Following full-screen window "${info.title}" (${target.sourceId})`
        : `Full-screen window "${info.title}" can't be window-captured; capturing ${info.screenLabel ?? 'its screen'} instead`,
    );
    this.startCapture(target);
    this.set({
      ...this.projection,
      following: info,
      state: 'starting',
      blank: false,
      message: null,
      token: this.token,
    });
  }

  /** Full screen ended: capture the picked window again. */
  followBack(): void {
    const picked = this.projection.source;
    if (!picked || !this.projection.following) return;
    log('info', `Full screen ended; back to "${picked.title}"`);
    this.startCapture(picked);
    this.set({
      ...this.projection,
      following: null,
      state: 'starting',
      blank: false,
      message: null,
      token: this.token,
    });
  }

  /** Status reported by the Output renderer about its capture. */
  handleStatus(s: SourceStatus): void {
    if (s.token !== this.token) return; // a newer capture superseded this one
    const src = this.projection.source;
    const following = this.projection.following;
    const title = following?.title ?? src?.title ?? 'The source';

    // A followed full-screen window that can't be captured is the follower's problem,
    // not "Source closed": it falls back to the screen, or back to the picked window.
    if (following?.mode === 'window') {
      if (s.state === 'ended' || s.state === 'error') {
        log(
          'warn',
          `Followed full-screen window "${title}": capture ${s.state} (${s.errorName ?? ''})`,
        );
        this.onFollowProblem?.(s.state);
        return;
      }
      if (s.state === 'live' && s.blank) this.onFollowProblem?.('blank');
    }

    switch (s.state) {
      case 'live':
        if (this.projection.state !== 'live' || this.projection.blank !== s.blank) {
          log(
            s.blank ? 'warn' : 'info',
            s.blank
              ? `"${title}" is capturing black frames (minimized or protected content)`
              : `Live: "${title}" ${s.width ?? '?'}×${s.height ?? '?'}`,
          );
        }
        this.set({
          ...this.projection,
          state: 'live',
          blank: s.blank,
          width: s.width,
          height: s.height,
          message: s.blank
            ? `“${title}” is showing black: if it's minimized, restore it; DRM-protected video always captures black.`
            : null,
        });
        break;
      case 'ended':
        log('warn', `Source ended: "${title}"`);
        this.set({
          ...this.projection,
          state: 'ended',
          blank: false,
          message: `“${title}” was closed or stopped sharing. The projector is showing black; pick another source.`,
        });
        break;
      case 'error': {
        const message = describeCaptureError(s.errorName, s.message);
        log('error', `Capture of "${title}" failed: ${s.errorName ?? ''} ${s.message ?? ''}`);
        this.set({ ...this.projection, state: 'error', blank: false, message });
        break;
      }
      case 'idle':
        break;
    }
  }
}
