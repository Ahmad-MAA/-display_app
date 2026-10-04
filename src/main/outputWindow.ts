import { BrowserWindow, screen, type Display } from 'electron';
import type { ContentProtectionStatus, OutputViewport, PlacementReport } from '@shared/diagnostics';
import { formatRect, rectEquals, type Rect } from '@shared/displays';
import type { OutputEventChannel, OutputEventMap } from '@shared/ipc';
import { applyContentProtection } from './contentProtection';
import { log } from './log';
import { lockDownNavigation, loadPage, preloadPath } from './windows';

const MAX_BOUNDS_ATTEMPTS = 3;
/** Wait for the renderer's resize to settle before cross-checking its viewport. */
const VIEWPORT_SETTLE_MS = 400;

/**
 * At fractional scale factors (125%, 150%) Windows rounds window sizes to whole
 * physical pixels, so a windowed getBounds() can read back 1–2 DIP off and never
 * converge (seen on real hardware: 1280×721 → 1281×722 at 150%). That is rounding,
 * not a DPI bug; full screen then snaps to the exact display bounds, which we
 * verify exactly afterwards.
 */
function withinRounding(a: Rect, b: Rect, scaleFactor: number): boolean {
  const tol = Math.max(1, Math.ceil(scaleFactor));
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  );
}
const FULLSCREEN_EVENT_TIMEOUT_MS = 1500;

function waitFor(win: BrowserWindow, event: 'enter-full-screen' | 'leave-full-screen') {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, FULLSCREEN_EVENT_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      win.removeListener(event as 'enter-full-screen', done);
      resolve();
    }
    win.once(event as 'enter-full-screen', done);
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Owns the borderless, black, full-screen Output BrowserWindow and its placement.
 *
 * Mixed DPI: Windows/Chromium can mis-size a window that is moved between monitors
 * with different scale factors (the size gets scaled by the DPI ratio on the first
 * move). We therefore always position with the TARGET display's DIP bounds, read
 * back getBounds(), and repeat/correct until they match, logging every mismatch.
 */
export class OutputWindow {
  readonly win: BrowserWindow;
  readonly contentProtection: ContentProtectionStatus;
  private viewport: OutputViewport | null = null;
  private lastBase: Omit<PlacementReport, 'viewport' | 'ok' | 'problems'> | null = null;
  private lastBaseProblems: string[] = [];
  private viewportTimer: NodeJS.Timeout | null = null;
  private lastProblemKey = '';
  /**
   * True from the moment a display change is noticed until the re-placement finishes.
   * Viewport reports in that window describe the OLD layout and must not be judged
   * against the old placement (that produced spurious "wrong DPI" warnings while
   * the user was changing scale/resolution).
   */
  private stale = false;
  private placing: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;

  constructor(private readonly onReport: (r: PlacementReport) => void) {
    this.win = new BrowserWindow({
      show: false,
      frame: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      autoHideMenuBar: true,
      hasShadow: false,
      title: 'ProjectorDesk Output',
      webPreferences: {
        preload: preloadPath('output'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // MANDATORY: exclude the Output window from all capture before it is ever shown,
    // otherwise capturing the projector screen produces an infinite recursive mirror.
    this.contentProtection = applyContentProtection(this.win);
    log(
      this.contentProtection.ok ? 'info' : 'warn',
      `Content protection: ${this.contentProtection.message}`,
    );
    lockDownNavigation(this.win);
    this.win.webContents.setZoomFactor(1);
    this.ready = loadPage(this.win, 'output').catch((err: unknown) => {
      log('error', `Output page failed to load: ${String(err)}`);
    });
  }

  send<K extends OutputEventChannel>(channel: K, payload: OutputEventMap[K]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  get isVisible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible();
  }

  hide(): void {
    if (this.win.isDestroyed()) return;
    if (this.win.isFullScreen()) this.win.setFullScreen(false);
    this.win.hide();
  }

  /** A display change was detected; a re-placement is coming. */
  markStale(): void {
    this.stale = true;
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    this.viewportTimer = null;
  }

  /** Renderer viewport arrives on every resize; it is judged only once placement settles. */
  setViewport(v: OutputViewport): void {
    this.viewport = v;
    if (!this.stale) this.scheduleViewportCheck();
  }

  private scheduleViewportCheck(): void {
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    this.viewportTimer = setTimeout(() => {
      this.viewportTimer = null;
      if (!this.lastBase || this.stale) return;
      const report = this.composeReport(true);
      const key = report.problems.join('|');
      if (key !== this.lastProblemKey && !report.ok) {
        log('warn', `Output viewport check: ${report.problems.join('; ')}`);
      }
      this.lastProblemKey = key;
      this.onReport(report);
    }, VIEWPORT_SETTLE_MS);
  }

  /** Serialized: overlapping display events never interleave two placements. */
  placeOn(display: Display): Promise<void> {
    this.placing = this.placing
      .then(() => this.doPlace(display))
      .catch((err: unknown) => {
        log('error', `Output placement failed: ${String(err)}`);
      });
    return this.placing;
  }

  /** Windowed placement. Returns whether a real (beyond-rounding) mismatch had to be corrected. */
  private setBoundsVerified(
    target: Rect,
    scaleFactor: number,
    phase: string,
  ): { attempts: number; actual: Rect; corrected: boolean } {
    let actual = this.win.getBounds();
    let attempts = 0;
    let corrected = false;
    while (attempts < MAX_BOUNDS_ATTEMPTS) {
      attempts++;
      this.win.setBounds(target);
      actual = this.win.getBounds();
      if (rectEquals(actual, target)) break;
      if (withinRounding(actual, target, scaleFactor)) {
        if (attempts === 1) {
          log(
            'info',
            `Windowed bounds ${formatRect(actual)} within scale-${scaleFactor} rounding of ${formatRect(target)} (${phase}); full screen will snap exactly`,
          );
        }
        break;
      }
      corrected = true;
      log(
        'warn',
        `DPI/bounds mismatch (${phase}, attempt ${attempts}): expected ${formatRect(target)}, got ${formatRect(actual)}; correcting`,
      );
    }
    return { attempts, actual, corrected };
  }

  private async doPlace(display: Display): Promise<void> {
    await this.ready;
    const win = this.win;
    if (win.isDestroyed()) return;
    this.stale = true;
    const target = { ...display.bounds };
    const primary = screen.getPrimaryDisplay();
    let corrected = false;

    if (win.isFullScreen()) {
      win.setFullScreen(false);
      await waitFor(win, 'leave-full-screen');
    }

    // 1) Windowed placement using the target display's DIP bounds (NOT workArea).
    // The first move across monitors converts DIPs through the SOURCE monitor's scale
    // (seen on hardware: primary 125% → secondary 100% read back 1918×1079 for 1920×1080),
    // so allow the rounding of whichever scale is larger.
    const fromScale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
    const roundingScale = Math.max(display.scaleFactor, fromScale);
    const first = this.setBoundsVerified(target, roundingScale, 'windowed');
    if (first.corrected) corrected = true;

    // 2) Show without stealing focus from the Control Panel, then go full screen.
    if (!win.isVisible()) win.showInactive();
    win.setFullScreen(true);
    await waitFor(win, 'enter-full-screen');
    await delay(50);

    // 3) Verify full-screen bounds and that Windows put us on the right monitor.
    let actual = win.getBounds();
    let matched = screen.getDisplayMatching(actual).id;
    if (!rectEquals(actual, target) || matched !== display.id) {
      corrected = true;
      log(
        'warn',
        `Full-screen placement mismatch on "${display.label || display.id}": expected ${formatRect(target)} (display ${display.id}), got ${formatRect(actual)} (display ${matched}); re-applying`,
      );
      win.setFullScreen(false);
      await waitFor(win, 'leave-full-screen');
      this.setBoundsVerified(target, roundingScale, 'retry');
      win.setFullScreen(true);
      await waitFor(win, 'enter-full-screen');
      await delay(50);
      actual = win.getBounds();
      matched = screen.getDisplayMatching(actual).id;
    }

    const problems: string[] = [];
    if (!rectEquals(actual, target)) {
      problems.push(
        `Output bounds ${formatRect(actual)} do not match display bounds ${formatRect(target)}`,
      );
    }
    if (matched !== display.id) {
      problems.push(`Output window is on display ${matched}, expected ${display.id}`);
    }
    if (!win.isFullScreen()) problems.push('Output window is not in full-screen mode');

    this.lastBase = {
      at: new Date().toISOString(),
      targetDisplayId: display.id,
      targetLabel: display.label || `Display ${display.id}`,
      expected: target,
      actual,
      matchedDisplayId: matched,
      fullScreen: win.isFullScreen(),
      attempts: first.attempts,
      corrected,
      targetScaleFactor: display.scaleFactor,
      primaryScaleFactor: primary.scaleFactor,
      mixedDpi: display.scaleFactor !== primary.scaleFactor,
    };
    this.lastBaseProblems = problems;
    // Judge bounds now; the renderer viewport is checked once its resize settles.
    const report = this.composeReport(false);
    this.lastProblemKey = report.problems.join('|');
    this.stale = false;
    log(
      report.ok ? 'info' : 'error',
      `Output placed on "${report.targetLabel}" ${formatRect(target)} scale ${display.scaleFactor} (primary ${primary.scaleFactor}${report.mixedDpi ? ', MIXED DPI' : ''}): ${report.ok ? 'OK' : report.problems.join('; ')}`,
    );
    this.onReport(report);
    this.scheduleViewportCheck();
  }

  /** Combine main-side bounds checks with what the renderer reports in physical pixels. */
  private composeReport(checkViewport: boolean): PlacementReport {
    if (!this.lastBase) throw new Error('no placement yet');
    const base = this.lastBase;
    const problems = [...this.lastBaseProblems];
    const v = this.viewport;
    if (checkViewport && v && this.win.isVisible()) {
      if (
        Math.abs(v.innerWidth - base.expected.width) > 1 ||
        Math.abs(v.innerHeight - base.expected.height) > 1
      ) {
        problems.push(
          `Renderer viewport ${v.innerWidth}×${v.innerHeight} DIP ≠ display ${base.expected.width}×${base.expected.height} DIP`,
        );
      }
      if (Math.abs(v.devicePixelRatio - base.targetScaleFactor) > 0.01) {
        problems.push(
          `Renderer devicePixelRatio ${v.devicePixelRatio} ≠ target scale factor ${base.targetScaleFactor} (window rendered at the wrong DPI)`,
        );
      }
    }
    return { ...base, viewport: v, ok: problems.length === 0, problems };
  }

  destroy(): void {
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
