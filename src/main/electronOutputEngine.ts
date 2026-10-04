import { session, webContents, type WebContents } from 'electron';
import type { SourceDescriptor } from '@shared/outputEngine';
import {
  describeCaptureError,
  IDLE_PROJECTION,
  type ProjectionInfo,
  type SourceStatus,
} from '@shared/projection';
import { log } from './log';
import type { OutputWindow } from './outputWindow';

/**
 * Phase 1 output engine: the Output BrowserWindow captures the chosen source itself
 * (getDisplayMedia), so frames never cross IPC. Main only decides WHICH source a
 * capture request receives, via setDisplayMediaRequestHandler.
 *
 * Build step 4 covers setSource / source-ended / errors; fill modes, crop, blank,
 * freeze, cursor and stats complete the OutputEngine contract in steps 5–7.
 */
export class ElectronOutputEngine {
  private projection: ProjectionInfo = IDLE_PROJECTION;
  private token = 0;

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
    // (low-res "On Projector" preview) receives the CURRENT source. Anyone else: denied.
    ses.setDisplayMediaRequestHandler(
      (request, callback) => {
        const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
        const src = this.projection.source;
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
    this.token++;
    log(
      'info',
      source
        ? `Projecting ${source.kind} "${source.title}" (${source.sourceId})`
        : 'Projection stopped',
    );
    this.set({
      ...IDLE_PROJECTION,
      source,
      state: source ? 'starting' : 'idle',
      token: this.token,
    });
    this.output.send('output:set-source', { token: this.token, source });
  }

  /** Status reported by the Output renderer about its capture. */
  handleStatus(s: SourceStatus): void {
    if (s.token !== this.token) return; // a newer projection superseded this one
    const src = this.projection.source;
    const title = src?.title ?? 'The source';
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
