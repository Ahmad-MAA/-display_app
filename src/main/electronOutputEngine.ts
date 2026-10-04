import { session, webContents, type WebContents } from 'electron';
import {
  DEFAULT_DISPLAY,
  normalizeCrop,
  type CropRect,
  type OutputDisplay,
} from '@shared/geometry';
import { DEFAULT_CONTROLS, type PresenterControls } from '@shared/controls';
import type { EngineStats, FillMode, SourceDescriptor } from '@shared/outputEngine';
import { evaluateSession, type SessionSummary } from '@shared/stats';
import {
  describeCaptureError,
  IDLE_PROJECTION,
  type FollowInfo,
  type ProjectionInfo,
  type SourceStatus,
} from '@shared/projection';
import { log } from './log';
import type { OutputStatsReport } from '@shared/ipc';
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
  private controls: PresenterControls = DEFAULT_CONTROLS;
  private stats: EngineStats | null = null;
  private statsEpoch = 0;
  private statsWhileHidden = false;
  private cursorHideSupported: boolean | null = null;
  /** Projection session being measured (one per capture token). */
  private session: {
    token: number;
    startedAt: number;
    source: SourceDescriptor;
    last: EngineStats | null;
    latencies: number[];
  } | null = null;
  /** Called with each finished session (logged by main; Phase 2 evidence). */
  onSession: ((s: SessionSummary) => void) | null = null;
  /** Refresh rate of the projector display, for stats and the Phase 2 verdict. */
  refreshRate: () => number = () => 60;
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

  get currentControls(): PresenterControls {
    return this.controls;
  }

  get currentStats(): EngineStats | null {
    return this.stats;
  }

  get cursorHide(): boolean | null {
    return this.cursorHideSupported;
  }

  private sendControls(): void {
    const { blank, freeze, statsOverlay } = this.controls;
    this.output.send('output:controls', {
      blank,
      freeze,
      statsOverlay,
      refreshRate: this.refreshRate(),
      statsEpoch: this.statsEpoch,
    });
  }

  private applyControls(c: PresenterControls): void {
    this.controls = c;
    this.sendControls();
    this.onChange(this.projection);
  }

  /** Output goes black; capture keeps running underneath. */
  blank(on: boolean): void {
    log('info', `Blank ${on ? 'on' : 'off'}`);
    this.applyControls({ ...this.controls, blank: on });
  }

  /** Hold the current frame. */
  freeze(on: boolean): void {
    log('info', `Freeze ${on ? 'on' : 'off'}`);
    this.applyControls({ ...this.controls, freeze: on });
  }

  setStatsOverlay(on: boolean): void {
    this.applyControls({ ...this.controls, statsOverlay: on });
  }

  /** Cursor capture is a getDisplayMedia constraint, so changing it restarts the capture. */
  setCursor(on: boolean): void {
    if (on === this.controls.cursor) return;
    if (!on && this.cursorHideSupported === false) {
      log('info', 'Hide cursor requested, but this capture path ignores it (Phase 1 limit)');
      this.onChange(this.projection);
      return;
    }
    log('info', `Cursor ${on ? 'shown' : 'hidden'}`);
    this.controls = { ...this.controls, cursor: on };
    if (this.effective) {
      this.startCapture(this.effective);
      this.set({ ...this.projection, state: 'starting', token: this.token });
    } else {
      this.onChange(this.projection);
    }
  }

  /** Resend everything the Output needs (e.g. after it was re-placed or reloaded). */
  resync(): void {
    this.output.send('output:display', this.display);
    this.sendControls();
  }

  /** Stats from the Output for the current capture (once per second). */
  handleStats(r: OutputStatsReport): void {
    if (r.token !== this.token) return;
    // A hidden Output (unplugged projector, emergency hide) composites almost nothing, so
    // presentedFrames gaps look like massive drops. Those numbers are meaningless: discard
    // them and don't let them into the session verdict.
    if (!this.output.isVisible) {
      this.statsWhileHidden = true;
      if (this.stats) {
        this.stats = null;
        this.onChange(this.projection);
      }
      if (this.session) {
        this.session.last = null;
        this.session.latencies = [];
        this.session.startedAt = Date.now();
      }
      return;
    }
    if (this.statsWhileHidden) {
      // Visible again: have the Output restart its counters; skip this polluted report.
      this.statsWhileHidden = false;
      this.statsEpoch++;
      this.sendControls();
      return;
    }
    const stats: EngineStats = {
      deliveredFps: r.deliveredFps,
      droppedFrames: r.droppedFrames,
      totalFrames: r.totalFrames,
      medianLatencyMs: r.medianLatencyMs,
      medianProcessingMs: r.medianProcessingMs,
      sourceWidth: r.sourceWidth,
      sourceHeight: r.sourceHeight,
      refreshRate: r.refreshRate,
    };
    this.stats = stats;
    if (this.session?.token === r.token) {
      this.session.last = stats;
      if (stats.medianLatencyMs !== null) this.session.latencies.push(stats.medianLatencyMs);
    }
    this.onChange(this.projection);
  }

  private endSession(): void {
    const s = this.session;
    this.session = null;
    if (!s?.last || s.last.totalFrames === 0) return;
    const hz = this.refreshRate();
    const sorted = [...s.latencies].sort((a, b) => a - b);
    const medianLatencyMs = sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? null) : null;
    const frames = s.last.totalFrames - s.last.droppedFrames;
    const verdict = evaluateSession(frames, s.last.droppedFrames, medianLatencyMs, hz);
    const ended = Date.now();
    this.onSession?.({
      startedAt: new Date(s.startedAt).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationS: Math.round((ended - s.startedAt) / 1000),
      source: s.source.title,
      sourceKind: s.source.kind,
      refreshRate: hz,
      frames,
      droppedFrames: s.last.droppedFrames,
      dropPercent: verdict.dropPercent,
      medianLatencyMs,
      needsNativeEngine: verdict.needsNativeEngine,
      reasons: verdict.reasons,
    });
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
    this.endSession();
    this.effective = source;
    this.token++;
    this.stats = null;
    if (source) {
      this.session = {
        token: this.token,
        startedAt: Date.now(),
        source,
        last: null,
        latencies: [],
      };
    }
    // Freezing belongs to one picture; a new capture always starts live.
    if (this.controls.freeze) {
      this.controls = { ...this.controls, freeze: false };
      this.sendControls();
    }
    this.output.send('output:set-source', {
      token: this.token,
      source,
      cursor: this.controls.cursor,
    });
  }

  /** End the current session (app quitting). */
  shutdown(): void {
    this.endSession();
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
        ? `Follow: capturing full-screen window "${info.title}" (${target.sourceId})`
        : `Follow: full-screen window "${info.title}" can't be window-captured; capturing ${info.screenLabel ?? 'its screen'} instead`,
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
    log('info', `Follow: full screen ended; back to "${picked.title}"`);
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
          `Follow: followed window "${title}": capture ${s.state} (${s.errorName ?? ''})`,
        );
        this.onFollowProblem?.(s.state);
        return;
      }
      if (s.state === 'live' && s.blank) this.onFollowProblem?.('blank');
    }

    switch (s.state) {
      case 'live':
        if (!this.controls.cursor) {
          // Chromium may ignore cursor: 'never' for some sources; tell the presenter.
          const hidden = s.cursor === 'never' ? true : s.cursor === null ? null : false;
          if (hidden !== this.cursorHideSupported) {
            this.cursorHideSupported = hidden;
            if (hidden === false) {
              // Chromium accepted cursor:'never' but still draws it. Don't keep a toggle
              // that does nothing: show the cursor state truthfully from now on.
              log(
                'warn',
                `Hide cursor isn't supported by Chromium's capture (it reported cursor: ${s.cursor ?? '?'}); the cursor stays visible. Needs the native engine.`,
              );
              this.controls = { ...this.controls, cursor: true };
            }
          }
        }
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
