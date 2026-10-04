import type { Rect } from '@shared/displays';
import {
  chooseFollow,
  decisionKey,
  describeWindows,
  Stabilizer,
  type WinInfo,
} from '@shared/follow';
import type { SourceDescriptor } from '@shared/outputEngine';
import type { ElectronOutputEngine, FollowProblem } from './electronOutputEngine';
import { log } from './log';
import type { WindowHelper } from './windowHelper';

const POLL_MS = 300;

export interface ScreenFallback {
  descriptor: SourceDescriptor;
  label: string;
}

/**
 * "Follow full screen" (see src/shared/follow.ts). While a WINDOW is projected and the
 * toggle is on, polls the window helper every 300 ms. When the picked app shows a separate
 * full-screen window (WMP, VLC, PowerPoint slide show), capture switches to it; when that
 * window goes away, capture returns to the picked window. If the full-screen window itself
 * can't be window-captured (error / black frames), capture falls back to its screen.
 * Each switch logs every top-level window of the app, for diagnosing new players.
 */
export class FullscreenFollower {
  private on = true;
  private picked: SourceDescriptor | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly stable = new Stabilizer(2);
  private followed: WinInfo | null = null;
  private fellBackFor: string | null = null;
  /** Consecutive black-frame reports from the followed window. */
  private blankCount = 0;
  /** Last logged set of full-screen windows seen (log on change only). */
  private seenKey = '';

  constructor(
    private readonly helper: WindowHelper,
    private readonly engine: ElectronOutputEngine,
    private readonly findScreen: (monitor: Rect) => ScreenFallback | null,
  ) {
    engine.onFollowProblem = (p) => {
      this.onProblem(p);
    };
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    log('info', `Follow full screen ${on ? 'on' : 'off'}`);
    if (on) {
      this.start();
    } else {
      this.stop();
      this.engine.followBack();
    }
  }

  /** Call after every engine.setSource(). */
  onProjected(source: SourceDescriptor | null): void {
    this.stop();
    this.picked = source?.kind === 'window' && source.hwnd ? source : null;
    this.start();
  }

  private start(): void {
    this.stop();
    this.stable.reset();
    this.followed = null;
    this.fellBackFor = null;
    this.blankCount = 0;
    this.seenKey = '';
    if (!this.on || !this.picked || !this.helper.available) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const picked = this.picked;
    if (this.polling || !picked?.hwnd) return;
    this.polling = true;
    try {
      const res = await this.helper.follow(picked.hwnd);
      if (!res || picked !== this.picked || !this.timer) return;
      const decision = chooseFollow(res.target, res.fullscreen, this.followed?.hwnd ?? null);
      // Log what was seen whenever it changes, even if nothing is followed, so an empty
      // trace can never hide why (a filtered-out candidate was exactly that bug).
      const seenKey = `${res.target.fullscreen ? 'self' : ''}|${res.fullscreen.map((w) => w.hwnd).join(',')}`;
      if (seenKey !== this.seenKey) {
        this.seenKey = seenKey;
        log(
          'info',
          `Follow: seen picked window ${describeWindows([res.target])}; same-process full-screen windows: ${res.fullscreen.length ? describeWindows(res.fullscreen) : 'none'} → ${decisionKey(decision)}`,
        );
      }
      if (!this.stable.push(decisionKey(decision))) return;
      log(
        'info',
        `Follow: decision ${decisionKey(decision)}; picked window ${describeWindows([res.target])}; full-screen candidates: ${res.fullscreen.length ? describeWindows(res.fullscreen) : 'none'}`,
      );
      if (decision.kind === 'window') {
        const w = decision.win;
        this.followed = w;
        this.fellBackFor = null;
        this.blankCount = 0;
        const title = w.title || picked.title;
        void this.diagnose(`${w.processName ?? 'app'} went full screen in a separate window`);
        this.engine.followTo(
          {
            sourceId: `window:${w.hwnd}:0`,
            kind: 'window',
            hwnd: w.hwnd,
            displayId: null,
            processName: w.processName,
            title,
          },
          { mode: 'window', title, screenLabel: null },
        );
      } else {
        this.followed = null;
        this.fellBackFor = null;
        this.engine.followBack();
      }
    } finally {
      this.polling = false;
    }
  }

  /** The followed window's capture failed or is black: capture its screen instead (once). */
  private onProblem(p: FollowProblem): void {
    const w = this.followed;
    log('info', `Follow: followed window reported "${p}"`);
    // 'ended' = the full-screen window closed; the next polls switch back to the picked window.
    if (p === 'ended' || !w?.monitor || this.fellBackFor === w.hwnd) return;
    // Players often show a black frame while entering full screen: only fall back to the
    // screen if black persists (two reports, ~2 s apart). Errors fall back immediately.
    if (p === 'blank' && ++this.blankCount < 2) return;
    this.fellBackFor = w.hwnd;
    const screen = this.findScreen(w.monitor);
    void this.diagnose(`window capture of the full-screen window gave ${p}`);
    if (!screen) {
      log(
        'warn',
        `Follow: no usable screen source for the full-screen window's monitor; staying on it`,
      );
      return;
    }
    this.engine.followTo(screen.descriptor, {
      mode: 'screen',
      title: w.title || this.picked?.title || 'Full screen',
      screenLabel: screen.label,
    });
  }

  /** Log every top-level window of the projected app (helps support new players). */
  async diagnose(reason: string): Promise<void> {
    const hwnd = this.picked?.hwnd;
    if (!hwnd || !this.helper.available) return;
    const list = await this.helper.inspect(hwnd);
    if (list.length > 0)
      log('info', `Follow: windows of the projected app (${reason}): ${describeWindows(list)}`);
  }
}
