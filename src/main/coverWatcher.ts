import { coveringKey, relevantCovering, type CoveringWindow } from '@shared/covering';
import { log } from './log';
import type { WindowHelper } from './windowHelper';

const POLL_MS = 1000;

/**
 * Warns when another app's window sits above the Output on the projector display
 * (e.g. a WPS/PowerPoint slide show with Presenter View, which is topmost there).
 * Polls only while the Output is visible. A new covering set must be seen twice in a
 * row (~1 s) before it's reported, so menus and tooltips don't flash a warning; it
 * clears as soon as nothing covers the projector.
 */
export class CoverWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private reported: CoveringWindow[] = [];
  private pendingKey: string | null = null;

  constructor(
    private readonly helper: WindowHelper,
    private readonly outputHwnd: () => string | null,
    private readonly ownHwnds: () => Set<string>,
    private readonly onChange: (list: CoveringWindow[]) => void,
  ) {}

  get current(): CoveringWindow[] {
    return this.reported;
  }

  /** Call whenever the Output's visibility may have changed. */
  setActive(active: boolean): void {
    if (active && !this.timer && this.helper.available) {
      this.timer = setInterval(() => void this.tick(), POLL_MS);
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.pendingKey = null;
      this.report([]);
    }
  }

  private report(list: CoveringWindow[]): void {
    if (coveringKey(list) === coveringKey(this.reported)) return;
    this.reported = list;
    if (list.length > 0) {
      log(
        'warn',
        `Projector display is covered by: ${list
          .map(
            (w) =>
              `"${w.title}" (${w.processName ?? '?'}${w.topmost ? ', topmost' : ''}${w.fullscreen ? ', full screen' : ''}, ${w.coverage}%)`,
          )
          .join('; ')}`,
      );
    } else {
      log('info', 'Projector display no longer covered');
    }
    this.onChange(list);
  }

  private async tick(): Promise<void> {
    const hwnd = this.outputHwnd();
    if (this.busy || !hwnd) return;
    this.busy = true;
    try {
      const list = relevantCovering(await this.helper.covering(hwnd), this.ownHwnds());
      const key = coveringKey(list);
      if (list.length === 0) {
        this.pendingKey = null;
        this.report([]);
      } else if (key === coveringKey(this.reported)) {
        this.pendingKey = null;
      } else if (key === this.pendingKey) {
        this.pendingKey = null;
        this.report(list);
      } else {
        this.pendingKey = key;
      }
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.setActive(false);
  }
}
